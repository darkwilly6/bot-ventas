import { getJSON, setJSON, delKey, listKeys } from "./store.mjs";
import { uid } from "./util.mjs";

const MAX_MESSAGES = 80;

// ---------- Conversaciones ----------
export function newConvo(waId, name, sim = false) {
  return {
    waId,
    name: name || "",
    sim,
    createdAt: Date.now(),
    lastAt: Date.now(),
    messages: [],
    labels: [],
    unread: 0,
    needsHuman: false,
    humanReason: "",
    botPaused: false,
    botPausedUntil: 0,
    state: { cart: [], customer: {}, checkout: false, paymentMethod: null, activeOrderId: null, activeOrderStatus: null, activeOrderCode: null },
  };
}

export async function loadConvo(waId) {
  return getJSON("convos", `c/${waId}`, null);
}

export function autoLabel(c) {
  const s = c.state || {};
  if (c.needsHuman) return "🆘 Necesita ayuda";
  switch (s.activeOrderStatus) {
    case "pago_por_verificar": return "💰 Pago por verificar";
    case "esperando_pago": return "⏳ Esperando pago";
    case "confirmado": return "✅ Pedido confirmado";
    case "enviado": return "🚚 Enviado";
    case "entregado": return "📦 Entregado";
  }
  if (s.checkout && s.cart?.length) return "📝 Cerrando pedido";
  if (s.cart?.length) return "🛒 Interesado";
  return c.messages.length > 2 ? "💬 Consultando" : "🆕 Nuevo";
}

export function isBotPaused(c) {
  if (c.botPaused) return true;
  return !!(c.botPausedUntil && c.botPausedUntil > Date.now());
}

export async function saveConvo(c) {
  if (c.messages.length > MAX_MESSAGES) c.messages = c.messages.slice(-MAX_MESSAGES);
  await setJSON("convos", `c/${c.waId}`, c);
  const idx = await getJSON("convos", "index", {});
  const last = c.messages[c.messages.length - 1];
  idx[c.waId] = {
    waId: c.waId,
    name: c.name,
    sim: !!c.sim,
    lastAt: c.lastAt,
    lastText: last ? `${last.from === "customer" ? "" : last.from === "owner" ? "Vos: " : "Bot: "}${(last.text || "").slice(0, 90)}` : "",
    unread: c.unread || 0,
    needsHuman: !!c.needsHuman,
    botPaused: isBotPaused(c),
    labels: c.labels || [],
    autoLabel: autoLabel(c),
    orderCode: c.state?.activeOrderCode || null,
  };
  await setJSON("convos", "index", idx);
}

export async function deleteConvo(waId) {
  await delKey("convos", `c/${waId}`);
  const idx = await getJSON("convos", "index", {});
  delete idx[waId];
  await setJSON("convos", "index", idx);
}

export async function listConvos() {
  const idx = await getJSON("convos", "index", {});
  return Object.values(idx).sort((a, b) => b.lastAt - a.lastAt);
}

export function pushMsg(c, msg) {
  c.messages.push({ id: uid(8), at: Date.now(), ...msg });
  c.lastAt = Date.now();
}

// ---------- Pedidos ----------
export async function loadOrder(id) {
  return getJSON("orders", `o/${id}`, null);
}

export async function saveOrder(o) {
  o.updatedAt = Date.now();
  await setJSON("orders", `o/${o.id}`, o);
}

export async function listOrders() {
  const keys = await listKeys("orders", "o/");
  const all = await Promise.all(keys.map((k) => getJSON("orders", k, null)));
  return all.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

export async function findOrderByCode(code) {
  const all = await listOrders();
  const c = String(code || "").trim().toUpperCase();
  return all.find((o) => o.code.toUpperCase() === c || o.code.toUpperCase().endsWith("-" + c));
}

// ---------- Notificaciones del panel ----------
export async function addNotif(n) {
  const list = await getJSON("notifs", "list", []);
  const item = { id: uid(10), at: Date.now(), read: false, ...n };
  list.unshift(item);
  await setJSON("notifs", "list", list.slice(0, 300));
  return item;
}

export async function listNotifs() {
  return getJSON("notifs", "list", []);
}

export async function markNotifs(ids) {
  const list = await getJSON("notifs", "list", []);
  for (const n of list) if (ids === "all" || ids.includes(n.id)) n.read = true;
  await setJSON("notifs", "list", list);
}
