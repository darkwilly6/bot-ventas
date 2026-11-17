// API del panel de administración
import { loadConfig, saveConfig, maskConfig } from "../lib/config.mjs";
import { loadCatalog, saveCatalog } from "../lib/catalog.mjs";
import { listConvos, loadConvo, saveConvo, deleteConvo, pushMsg, listOrders, loadOrder, saveOrder, listNotifs, markNotifs } from "../lib/data.mjs";
import { applyOrderAction } from "../lib/orders.mjs";
import { handleInbound } from "../lib/engine.mjs";
import { waClient, simClient } from "../lib/whatsapp.mjs";
import { geminiJSON } from "../lib/ai.mjs";
import { getBinary } from "../lib/store.mjs";
import { makeToken, checkToken, checkPassword } from "../lib/auth.mjs";
import { json, onlyDigits } from "../lib/util.mjs";

export const config = { path: "/api/*" };

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const parts = path.split("/").map(decodeURIComponent);
  const method = req.method;

  try {
    if (path === "login" && method === "POST") {
      if (!process.env.ADMIN_PASSWORD) return json({ error: "Falta configurar la variable ADMIN_PASSWORD en Netlify (Site configuration → Environment variables)." }, 400);
      const { password } = await req.json();
      if (!checkPassword(password)) return json({ error: "Contraseña incorrecta" }, 401);
      return json({ token: makeToken() });
    }

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("t");
    if (!checkToken(token)) return json({ error: "No autorizado" }, 401);

    const body = ["POST", "PUT", "PATCH"].includes(method) ? await req.json().catch(() => ({})) : {};

    // ----- Estado general -----
    if (path === "status") {
      const cfg = await loadConfig();
      const c = cfg.connections;
      return json({
        siteUrl: process.env.URL || url.origin,
        webhookUrl: `${process.env.URL || url.origin}/webhook`,
        whatsapp: !!(c.waToken && c.phoneNumberId),
        verifyToken: !!c.verifyToken,
        ai: !!(c.geminiKey || c.groqKey),
        email: !!(c.resendKey && cfg.notify.email),
        ownerPhone: !!cfg.notify.ownerPhone,
      });
    }

    // ----- Configuración -----
    if (path === "config") {
      if (method === "GET") return json(maskConfig(await loadConfig()));
      if (method === "PUT") {
        delete body._env;
        await saveConfig(body);
        return json(maskConfig(await loadConfig()));
      }
    }

    // ----- Catálogo -----
    if (path === "catalog") {
      if (method === "GET") return json(await loadCatalog());
      if (method === "PUT") return json(await saveCatalog(body));
    }

    // ----- Conversaciones -----
    if (parts[0] === "conversations") {
      if (parts.length === 1 && method === "GET") return json(await listConvos());
      const waId = parts[1];
      const c = await loadConvo(waId);
      if (!c && method !== "DELETE") return json({ error: "No existe" }, 404);
      if (parts.length === 2 && method === "GET") {
        if (c.unread) { c.unread = 0; await saveConvo(c); }
        const orders = (await listOrders()).filter((o) => o.waId === waId);
        return json({ convo: c, orders });
      }
      if (parts.length === 2 && method === "DELETE") { await deleteConvo(waId); return json({ ok: true }); }
      if (parts[2] === "send" && method === "POST") {
        const cfg = await loadConfig();
        const text = String(body.text || "").trim();
        if (!text) return json({ error: "Mensaje vacío" }, 400);
        if (!c.sim) await waClient(cfg.connections).text(waId, text);
        pushMsg(c, { from: "owner", text });
        const h = Number(cfg.bot.pauseOnManualReplyHours) || 0;
        if (body.pause !== false && h > 0) c.botPausedUntil = Date.now() + h * 3600 * 1000;
        await saveConvo(c);
        return json({ ok: true, convo: c });
      }
      if (parts[2] === "bot" && method === "POST") {
        c.botPaused = !!body.paused;
        c.botPausedUntil = 0;
        if (!body.paused) { c.needsHuman = false; c.humanReason = ""; }
        await saveConvo(c);
        return json({ ok: true, convo: c });
      }
      if (parts[2] === "labels" && method === "POST") {
        c.labels = (body.labels || []).map(String).slice(0, 20);
        await saveConvo(c);
        return json({ ok: true, convo: c });
      }
      if (parts[2] === "resolve" && method === "POST") {
        c.needsHuman = false;
        c.humanReason = "";
        c.botPausedUntil = 0;
        c.botPaused = false;
        await saveConvo(c);
        return json({ ok: true, convo: c });
      }
      if (parts[2] === "customer" && method === "POST") {
        c.state.customer = { ...c.state.customer, ...(body.customer || {}) };
        await saveConvo(c);
        return json({ ok: true, convo: c });
      }
    }

    // ----- Pedidos -----
    if (parts[0] === "orders") {
      if (parts.length === 1 && method === "GET") return json(await listOrders());
      const id = parts[1];
      if (parts[2] === "action" && method === "POST") {
        const cfg = await loadConfig();
        const r = await applyOrderAction(cfg, id, body.action, body.note || "");
        return json(r);
      }
      if (parts.length === 2 && method === "PUT") {
        const o = await loadOrder(id);
        if (!o) return json({ error: "No existe" }, 404);
        if (body.customer) o.customer = { ...o.customer, ...body.customer };
        if (typeof body.notes === "string") o.notes = body.notes;
        await saveOrder(o);
        return json(o);
      }
    }

    // ----- Comprobantes (imágenes) -----
    if (parts[0] === "media" && method === "GET") {
      const key = parts.slice(1).join("/");
      const data = await getBinary("media", key);
      if (!data) return new Response("No encontrado", { status: 404 });
      return new Response(data, { headers: { "Content-Type": url.searchParams.get("mime") || "image/jpeg", "Cache-Control": "private, max-age=3600" } });
    }

    // ----- Notificaciones -----
    if (path === "notifications") {
      if (method === "GET") return json(await listNotifs());
      if (method === "POST") { await markNotifs(body.ids || "all"); return json({ ok: true }); }
    }

    // ----- Simulador -----
    if (path === "simulate" && method === "POST") {
      const cfg = await loadConfig();
      const t = simClient();
      const waId = `sim-${String(body.session || "demo").replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;
      const m = body.image
        ? { kind: "image", inline: body.image, mime: body.image.mime, text: body.text || "", display: `[🖼️ Imagen] ${body.text || ""}` }
        : body.buttonId
        ? { kind: "button", buttonId: body.buttonId, text: body.text, display: `🔘 ${body.text}` }
        : { kind: "text", text: String(body.text || "") };
      await handleInbound({ waId, name: "Cliente de prueba", msgs: [m], transport: t, sim: true, cfg });
      return json({ waId, outputs: t.outputs });
    }

    // ----- Pruebas de conexión -----
    if (path === "test/whatsapp" && method === "POST") {
      const cfg = await loadConfig();
      const to = onlyDigits(body.to || cfg.notify.ownerPhone);
      if (!to) return json({ error: "Indicá un número" }, 400);
      await waClient(cfg.connections).buttons(to, "✅ ¡Tu bot de ventas está conectado! ¿Todo bien por aquí?", [
        { id: "T:Todo bien", title: "Todo bien 👌" },
        { id: "T:Probar bot", title: "Probar el bot" },
      ]);
      return json({ ok: true });
    }
    if (path === "test/ai" && method === "POST") {
      const cfg = await loadConfig();
      const c = cfg.connections;
      if (!c.geminiKey) return json({ error: "Falta la API key de Gemini" }, 400);
      const r = await geminiJSON({
        key: c.geminiKey,
        model: c.geminiModel,
        contents: [{ role: "user", parts: [{ text: 'Respondé en JSON {"ok":true,"saludo":"..."} con un saludo corto salvadoreño.' }] }],
      });
      return json({ ok: true, result: r });
    }

    return json({ error: "Ruta no encontrada" }, 404);
  } catch (e) {
    console.error("api", e);
    return json({ error: e.message || "Error" }, 500);
  }
};
