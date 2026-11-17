// Avisos al dueño: panel + WhatsApp personal + correo (Resend, gratis)
import { addNotif } from "./data.mjs";
import { waClient } from "./whatsapp.mjs";
import { onlyDigits } from "./util.mjs";

export async function notifyOwner(cfg, { type, title, body, waId, orderId, buttons, sim }) {
  const notif = await addNotif({ type, title: (sim ? "[PRUEBA] " : "") + title, body, waId, orderId, sim: !!sim });
  if (sim) return notif;
  const wanted =
    (type === "order_new" && cfg.notify.onNewOrder) ||
    (type === "payment" && cfg.notify.onPayment) ||
    (type === "human" && cfg.notify.onHuman) ||
    type === "error";
  if (!wanted) return notif;

  const panel = process.env.URL ? `\n\n🔗 Panel: ${process.env.URL}` : "";
  const text = `🔔 *${title}*\n\n${body}${panel}`;
  const owner = onlyDigits(cfg.notify.ownerPhone);
  let waOk = false;
  if (owner && cfg.connections.waToken) {
    try {
      const wa = waClient(cfg.connections);
      if (buttons?.length) await wa.buttons(owner, text, buttons);
      else await wa.text(owner, text);
      waOk = true;
    } catch (e) {
      console.error("Aviso WhatsApp al dueño falló:", e.message);
      await addNotif({
        type: "error",
        title: "No pude avisarte por WhatsApp",
        body: `WhatsApp solo deja escribirte gratis si le enviaste un mensaje al bot desde tu número personal en las últimas 24 horas. Mandale "hola" al número del negocio para reactivar los avisos. (Detalle: ${e.message})`,
      });
    }
  }
  if (cfg.notify.email && cfg.connections.resendKey) {
    try {
      await sendEmail(cfg, `${title} — ${cfg.business.name}`, text);
    } catch (e) {
      console.error("Correo falló:", e.message);
    }
  }
  return { ...notif, waOk };
}

export async function sendEmail(cfg, subject, text) {
  const html = `<div style="font-family:system-ui,Arial;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(text).replace(/\*(.+?)\*/g, "<b>$1</b>")}</div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.connections.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Bot ${cfg.business.name} <onboarding@resend.dev>`, to: [cfg.notify.email], subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
