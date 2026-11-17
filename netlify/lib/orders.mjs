import { loadOrder, saveOrder, loadConvo, saveConvo } from "./data.mjs";
import { loadCatalog, saveCatalog, decrementStock } from "./catalog.mjs";
import { waClient } from "./whatsapp.mjs";
import { say } from "./messaging.mjs";
import { money } from "./util.mjs";

export const STATUS_LABEL = {
  esperando_pago: "⏳ Esperando pago",
  pago_por_verificar: "💰 Pago por verificar",
  confirmado: "✅ Confirmado",
  enviado: "🚚 Enviado",
  entregado: "📦 Entregado",
  cancelado: "❌ Cancelado",
};

export function computeTotals(cart, method, payments) {
  const subtotal = Math.round(cart.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0) * 100) / 100;
  const ship = Number(payments.shippingCost) || 0;
  if (method === "anticipo") {
    const total = subtotal + ship;
    const deposit = Math.min(Number(payments.depositAmount) || 0, total);
    return { subtotal, shipping: ship, total, payNow: deposit, payOnDelivery: Math.round((total - deposit) * 100) / 100 };
  }
  const shipping = payments.freeShippingOnFull ? 0 : ship;
  const total = subtotal + shipping;
  return { subtotal, shipping, total, payNow: total, payOnDelivery: 0 };
}

export function itemsText(items, cur) {
  return items.map((it) => `• ${it.product}${it.label ? ` (${it.label})` : ""} x${it.qty} — ${money(it.price * it.qty, cur)}`).join("\n");
}

export function customerText(cfg, customer) {
  return cfg.customerFields
    .filter((f) => customer?.[f.key])
    .map((f) => `${f.label}: ${customer[f.key]}`)
    .join("\n");
}

export function summaryText(cfg, { items, method, totals, customer }) {
  const cur = cfg.business.currency || "$";
  const lines = [
    "🧾 *Resumen de tu pedido*",
    "",
    itemsText(items, cur),
    "",
    `Subtotal: ${money(totals.subtotal, cur)}`,
    `Envío: ${totals.shipping ? money(totals.shipping, cur) : "GRATIS 🎁"}`,
    `*Total: ${money(totals.total, cur)}*`,
    "",
  ];
  if (method === "anticipo") {
    lines.push(`💵 Anticipo a pagar ahora: *${money(totals.payNow, cur)}*`);
    lines.push(`📦 Pagás contra entrega: *${money(totals.payOnDelivery, cur)}*`);
  } else {
    lines.push(`💳 Pago completo por transferencia: *${money(totals.payNow, cur)}*`);
  }
  const ct = customerText(cfg, customer);
  if (ct) lines.push("", "📍 *Datos de envío*", ct);
  return lines.join("\n");
}

export function paymentInstructions(cfg, order) {
  const cur = cfg.business.currency || "$";
  const accounts = (cfg.payments.accounts || []).filter((a) => a.number || a.bank);
  const lines = [`🎉 ¡Pedido *${order.code}* registrado!`, "", `Para confirmarlo, transferí o depositá *${money(order.payNow, cur)}* a:`];
  for (const a of accounts) {
    lines.push("", `🏦 *${a.bank || "Banco"}*${a.type ? ` (${a.type})` : ""}`, `N.º ${a.number}`, a.holder ? `A nombre de: ${a.holder}` : "");
  }
  if (cfg.payments.otherInstructions) lines.push("", cfg.payments.otherInstructions);
  lines.push("", "Después enviame por aquí la *foto o captura del comprobante* 📸");
  if (order.payOnDelivery > 0) lines.push(`💵 El resto (${money(order.payOnDelivery, cur)}) lo pagás contra entrega.`);
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

// Acciones del dueño sobre un pedido (desde el panel o desde su WhatsApp)
export async function applyOrderAction(cfg, orderId, action, note = "") {
  const o = await loadOrder(orderId);
  if (!o) throw new Error("Pedido no encontrado");
  const cur = cfg.business.currency || "$";
  const convo = await loadConvo(o.waId);
  const t = o.sim ? null : waClient(cfg.connections);
  let msg = null;
  switch (action) {
    case "confirm": {
      o.status = "confirmado";
      if (!o.stockApplied) {
        const cat = await loadCatalog();
        if (decrementStock(cat, o.items)) await saveCatalog(cat);
        o.stockApplied = true;
      }
      msg = {
        text: `✅ ¡Pago confirmado! Tu pedido *${o.code}* ya está en preparación 🙌\n\n⏱️ Tiempo de entrega: ${cfg.payments.deliveryTime || "pronto"}.${o.payOnDelivery > 0 ? `\n💵 Recordá tener listos ${money(o.payOnDelivery, cur)} para pagar al recibir.` : ""}\n\n¿Querés ver algo más del catálogo o te aviso cuando salga a ruta?`,
        buttons: [{ id: "T:Ver catálogo", title: "Ver catálogo" }, { id: "T:Avisame", title: "Avisame 👌" }],
      };
      break;
    }
    case "reject":
      o.status = "esperando_pago";
      msg = {
        text: `⚠️ No pudimos verificar el comprobante de tu pedido *${o.code}*.${note ? `\nMotivo: ${note}` : ""}\n\n¿Lo enviás de nuevo o preferís hablar con un asesor?`,
        buttons: [{ id: "PAID", title: "Reenviar comprobante" }, { id: "HUMAN", title: "Hablar con asesor" }],
      };
      break;
    case "ship":
      o.status = "enviado";
      msg = { text: `🚚 ¡Tu pedido *${o.code}* va en camino!${o.payOnDelivery > 0 ? `\n💵 Monto a pagar al recibir: *${money(o.payOnDelivery, cur)}*` : ""}${note ? `\n${note}` : ""}` };
      break;
    case "deliver":
      o.status = "entregado";
      msg = {
        text: `📦 ¡Pedido *${o.code}* entregado! Gracias por tu compra 💛\n\n¿Te gustaría ver lo nuevo o dejarnos tu opinión?`,
        buttons: [{ id: "T:Ver lo nuevo", title: "Ver lo nuevo" }, { id: "T:Dejar opinión", title: "Dejar opinión" }],
      };
      break;
    case "cancel":
      o.status = "cancelado";
      msg = { text: `Tu pedido *${o.code}* fue cancelado.${note ? `\nMotivo: ${note}` : ""} Si fue un error, escribinos y lo resolvemos 🙏` };
      break;
    case "note":
      o.notes = note;
      break;
    default:
      throw new Error("Acción no válida");
  }
  o.history = o.history || [];
  o.history.push({ at: Date.now(), action, note });
  await saveOrder(o);
  let sendErrors = [];
  if (convo) {
    if (convo.state.activeOrderId === o.id) convo.state.activeOrderStatus = o.status;
    if (action === "confirm" || action === "reject") {
      convo.needsHuman = false;
    }
    if (msg) sendErrors = await say(t, convo, msg);
    await saveConvo(convo);
  }
  return { order: o, sendErrors };
}
