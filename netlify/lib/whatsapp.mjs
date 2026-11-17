// Cliente de la API oficial de WhatsApp (Cloud API de Meta)
import { clip } from "./util.mjs";

export function waClient(conn) {
  const base = `https://graph.facebook.com/${conn.graphVersion || "v22.0"}`;
  const auth = { Authorization: `Bearer ${conn.waToken}` };

  async function call(path, body) {
    if (!conn.waToken || !conn.phoneNumberId) throw new Error("WhatsApp no está configurado (token / Phone Number ID).");
    const r = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j?.error?.message || `WhatsApp API ${r.status}`);
      e.code = j?.error?.code;
      e.details = j;
      throw e;
    }
    return j;
  }

  const send = (to, payload) =>
    call(`${conn.phoneNumberId}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to, ...payload });

  return {
    kind: "whatsapp",
    text: (to, body) => send(to, { type: "text", text: { body: String(body).slice(0, 4096), preview_url: false } }),
    buttons: (to, body, buttons) =>
      send(to, {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: clip(body, 1024) },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: String(b.id).slice(0, 256), title: clip(b.title, 20) } })),
          },
        },
      }),
    list: (to, body, buttonText, sections) =>
      send(to, {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: clip(body, 1024) },
          action: {
            button: clip(buttonText || "Ver opciones", 20),
            sections: sections.map((s) => ({
              title: clip(s.title || "Opciones", 24),
              rows: s.rows.map((r) => {
                const row = { id: String(r.id).slice(0, 200), title: clip(r.title, 24) };
                if (r.description) row.description = clip(r.description, 72);
                return row;
              }),
            })),
          },
        },
      }),
    image: (to, link, caption) => send(to, { type: "image", image: caption ? { link, caption: clip(caption, 1024) } : { link } }),
    markRead: (messageId, typing = true) =>
      call(`${conn.phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        ...(typing ? { typing_indicator: { type: "text" } } : {}),
      }),
    async media(id) {
      const r = await fetch(`${base}/${id}`, { headers: auth });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j?.error?.message || "No se pudo obtener el archivo");
      const r2 = await fetch(j.url, { headers: auth });
      if (!r2.ok) throw new Error("No se pudo descargar el archivo");
      return { mime: (j.mime_type || "application/octet-stream").split(";")[0].trim(), data: Buffer.from(await r2.arrayBuffer()) };
    },
  };
}

// Transporte falso para el simulador del panel: guarda lo que el bot "enviaría".
export function simClient() {
  const outputs = [];
  return {
    kind: "sim",
    outputs,
    text: async (to, body) => outputs.push({ type: "text", text: body }),
    buttons: async (to, body, buttons) => outputs.push({ type: "buttons", text: body, buttons }),
    list: async (to, body, buttonText, sections) => outputs.push({ type: "list", text: body, button: buttonText, sections }),
    image: async (to, link, caption) => outputs.push({ type: "image", link, caption }),
    markRead: async () => {},
    async media(id, inline) {
      if (inline) return { mime: inline.mime, data: Buffer.from(inline.base64, "base64") };
      throw new Error("Sin archivo");
    },
  };
}
