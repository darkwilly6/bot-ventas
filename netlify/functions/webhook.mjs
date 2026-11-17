// Webhook que recibe los mensajes de WhatsApp (Meta Cloud API)
import crypto from "node:crypto";
import { loadConfig } from "../lib/config.mjs";
import { waClient } from "../lib/whatsapp.mjs";
import { handleInbound } from "../lib/engine.mjs";
import { getJSON, setJSON, store, listKeys, delKey } from "../lib/store.mjs";
import { loadConvo, saveConvo, newConvo, pushMsg, addNotif } from "../lib/data.mjs";
import { sleep } from "../lib/util.mjs";

const DEBOUNCE_MS = 1500;

export default async (req, context) => {
  const cfg = await loadConfig();
  const conn = cfg.connections;

  // Verificación del webhook (Meta hace un GET al configurarlo)
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("hub.mode") === "subscribe" && conn.verifyToken && u.searchParams.get("hub.verify_token") === conn.verifyToken) {
      return new Response(u.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("Token de verificación incorrecto", { status: 403 });
  }
  if (req.method !== "POST") return new Response("OK");

  const raw = await req.text();
  if (conn.appSecret) {
    const sig = req.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", conn.appSecret).update(raw).digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return new Response("Firma inválida", { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response("OK"); }

  const work = processWebhook(body, cfg).catch((e) => console.error("webhook", e));
  if (context && typeof context.waitUntil === "function") {
    context.waitUntil(work);
    return new Response("OK");
  }
  await work;
  return new Response("OK");
};

export const config = { path: "/webhook" };

function parseMessage(msg) {
  const base = { waMsgId: msg.id, ts: Number(msg.timestamp || 0) * 1000 };
  switch (msg.type) {
    case "text":
      return { ...base, kind: "text", text: msg.text?.body || "" };
    case "interactive": {
      const br = msg.interactive?.button_reply;
      const lr = msg.interactive?.list_reply;
      if (br) return { ...base, kind: "button", buttonId: br.id, text: br.title, display: `🔘 ${br.title}` };
      if (lr) {
        const t = lr.description ? `${lr.title} — ${lr.description}` : lr.title;
        return { ...base, kind: "list", buttonId: lr.id, text: t, display: `📋 ${t}` };
      }
      return { ...base, kind: "text", text: "[respuesta interactiva]" };
    }
    case "button":
      return { ...base, kind: "button", buttonId: msg.button?.payload, text: msg.button?.text || "", display: `🔘 ${msg.button?.text || ""}` };
    case "image":
      return { ...base, kind: "image", mediaId: msg.image?.id, mime: msg.image?.mime_type, text: msg.image?.caption || "", display: `[🖼️ Imagen] ${msg.image?.caption || ""}` };
    case "document":
      return { ...base, kind: "document", mediaId: msg.document?.id, mime: msg.document?.mime_type, text: msg.document?.caption || msg.document?.filename || "", display: `[📄 Documento] ${msg.document?.filename || ""}` };
    case "audio":
      return { ...base, kind: "audio", mediaId: msg.audio?.id, mime: msg.audio?.mime_type, text: "", display: "[🎤 Audio]" };
    case "video":
      return { ...base, kind: "video", mediaId: msg.video?.id, text: msg.video?.caption || "", display: "[🎬 Video]" };
    case "location": {
      const l = msg.location || {};
      const t = `📍 Ubicación compartida: ${l.name ? l.name + ", " : ""}${l.address ? l.address + " " : ""}https://maps.google.com/?q=${l.latitude},${l.longitude}`;
      return { ...base, kind: "text", text: t };
    }
    case "sticker":
      return { ...base, kind: "text", text: "[sticker 😄]" };
    case "reaction":
      return null;
    default:
      return { ...base, kind: "text", text: `[mensaje tipo ${msg.type}]` };
  }
}

async function processWebhook(body, cfg) {
  const wa = waClient(cfg.connections);
  const batches = new Map(); // waId -> { name, keys:[] }

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};

      // Coexistencia: mensajes que el dueño envía desde la app de WhatsApp Business
      for (const echo of v.message_echoes || []) {
        await recordOwnerEcho(cfg, echo);
      }

      // Errores de entrega
      for (const s of v.statuses || []) {
        if (s.status === "failed") {
          const err = s.errors?.[0];
          await addNotif({ type: "error", title: "Mensaje no entregado", body: `A +${s.recipient_id}: ${err?.title || ""} ${err?.error_data?.details || ""} (código ${err?.code || "?"})`, waId: s.recipient_id });
        }
      }

      for (const msg of v.messages || []) {
        // Evitar procesar dos veces (Meta reintenta)
        const seenKey = `seen/${msg.id}`;
        if (await getJSON("inbox", seenKey, null)) continue;
        await setJSON("inbox", seenKey, { at: Date.now() });
        const parsed = parseMessage(msg);
        if (!parsed) continue;
        if (parsed.ts && Date.now() - parsed.ts > 15 * 60 * 1000) continue; // mensaje viejo
        const name = (v.contacts || []).find((c) => c.wa_id === msg.from)?.profile?.name || "";
        const key = `q/${msg.from}/${String(Date.now()).padStart(15, "0")}-${msg.id}`;
        await setJSON("inbox", key, parsed);
        if (!batches.has(msg.from)) batches.set(msg.from, { name, keys: [] });
        batches.get(msg.from).keys.push(key);
        wa.markRead(msg.id, true).catch(() => wa.markRead(msg.id, false).catch(() => {}));
      }
    }
  }

  // Agrupar ráfagas de mensajes: esperar un momento y procesar todo junto
  await Promise.all(
    [...batches].map(async ([waId, { name, keys }]) => {
      await sleep(DEBOUNCE_MS);
      const pending = (await listKeys("inbox", `q/${waId}/`)).sort();
      if (!pending.length) return;
      const latest = pending[pending.length - 1];
      if (!keys.includes(latest)) return; // llegó un mensaje más nuevo; esa ejecución lo procesa
      const msgs = [];
      for (const k of pending) {
        const m = await getJSON("inbox", k, null);
        if (m) msgs.push(m);
        await delKey("inbox", k);
      }
      if (msgs.length) await handleInbound({ waId, name, msgs, transport: wa, cfg });
    })
  );
}

async function recordOwnerEcho(cfg, echo) {
  const to = echo.to;
  if (!to) return;
  const text = echo.text?.body || (echo.type ? `[${echo.type}]` : "");
  const c = (await loadConvo(to)) || newConvo(to, "");
  pushMsg(c, { from: "owner", text });
  c.unread = 0;
  const h = Number(cfg.bot.pauseOnManualReplyHours) || 0;
  if (h > 0) c.botPausedUntil = Date.now() + h * 3600 * 1000;
  await saveConvo(c);
}
