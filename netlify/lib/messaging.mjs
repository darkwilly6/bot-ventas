// Envía mensajes (texto, botones, listas, fotos) y los registra en la conversación
import { pushMsg } from "./data.mjs";
import { clip } from "./util.mjs";

export async function say(t, convo, { text = "", buttons = [], list = null, images = [] }) {
  const to = convo.waId;
  const errors = [];
  for (const im of images || []) {
    try {
      if (t) await t.image(to, im.link, im.caption);
      pushMsg(convo, { from: "bot", text: `[🖼️ Foto] ${im.caption || ""}`, image: im.link });
    } catch (e) {
      errors.push(e.message);
    }
  }
  // Limpiar botones: únicos, máx 3, títulos ≤ 20
  const seen = new Set();
  const btns = [];
  for (const b of buttons || []) {
    const title = clip(b.title, 20);
    const k = title.toLowerCase();
    if (!title || seen.has(k)) continue;
    seen.add(k);
    btns.push({ id: b.id || `T:${title}`, title });
    if (btns.length === 3) break;
  }
  text = String(text || "").trim();
  try {
    if (list && list.rows?.length) {
      let body = text || "Elegí una opción 👇";
      if (body.length > 1000) {
        if (t) await t.text(to, body);
        body = "Elegí una opción 👇";
      }
      const rows = list.rows.slice(0, 10).map((r, i) => ({ id: r.id || `L:${i}`, title: clip(r.title, 24), description: r.description ? clip(r.description, 72) : undefined }));
      if (t) await t.list(to, body, list.button || "Ver opciones", [{ title: list.title || "Opciones", rows }]);
      pushMsg(convo, { from: "bot", text, list: rows.map((r) => r.title), listIds: rows.map((r) => r.id), listButton: list.button || "Ver opciones" });
    } else if (btns.length) {
      let body = text || "¿Qué preferís?";
      if (body.length > 1000) {
        if (t) await t.text(to, body);
        body = "¿Qué preferís? 👇";
      }
      if (t) await t.buttons(to, body, btns);
      pushMsg(convo, { from: "bot", text, buttons: btns.map((b) => b.title), btnIds: btns.map((b) => b.id) });
    } else if (text) {
      if (t) await t.text(to, text);
      pushMsg(convo, { from: "bot", text });
    }
  } catch (e) {
    // Si falla el mensaje interactivo, intentar como texto simple
    errors.push(e.message);
    try {
      const opts = list?.rows?.length ? list.rows.map((r) => `• ${r.title}`) : btns.map((b, i) => `${i + 1}. ${b.title}`);
      const fallback = [text, opts.join("\n")].filter(Boolean).join("\n\n");
      if (t && fallback) await t.text(to, fallback);
      pushMsg(convo, { from: "bot", text: fallback, error: e.message });
    } catch (e2) {
      errors.push(e2.message);
      pushMsg(convo, { from: "bot", text: text + `\n[⚠️ No se pudo enviar: ${e2.message}]`, error: e2.message });
    }
  }
  return errors;
}
