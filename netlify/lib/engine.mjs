// Motor del bot: decide qué responder en cada turno
import { loadConfig } from "./config.mjs";
import { loadCatalog, catalogForAI, resolveVariant, productImages, isAvailable } from "./catalog.mjs";
import { askSalesAI, analyzeReceipt } from "./ai.mjs";
import { loadConvo, saveConvo, newConvo, pushMsg, isBotPaused, loadOrder, saveOrder, listOrders, findOrderByCode } from "./data.mjs";
import { notifyOwner } from "./notify.mjs";
import { say } from "./messaging.mjs";
import { computeTotals, summaryText, paymentInstructions, itemsText, customerText, applyOrderAction, STATUS_LABEL } from "./orders.mjs";
import { setBinary } from "./store.mjs";
import { money, uid, orderCode, onlyDigits, norm } from "./util.mjs";

const SPECIAL = new Set(["HUMAN", "PAY_FULL", "PAY_DEPOSIT", "CONFIRM", "EDIT", "PAID"]);

export function missingFields(cfg, customer = {}) {
  return cfg.customerFields.filter((f) => f.required && !String(customer[f.key] || "").trim());
}

function firstName(c) {
  return String(c.state.customer?.nombre || c.name || "").split(" ")[0];
}

function hashOf(obj) {
  return JSON.stringify(obj);
}

// ---------- Punto de entrada ----------
// msgs: [{ kind, text, buttonId, mediaId, mime, inline:{mime,base64}, display, waMsgId }]
export async function handleInbound({ waId, name, msgs, transport, sim = false, cfg: cfgIn }) {
  const cfg = cfgIn || (await loadConfig());

  if (!sim && cfg.notify.ownerPhone && onlyDigits(cfg.notify.ownerPhone) === onlyDigits(waId)) {
    return handleOwner({ cfg, waId, msgs, t: transport });
  }

  let convo = (await loadConvo(waId)) || newConvo(waId, name, sim);
  if (name && !convo.name) convo.name = name;
  for (const m of msgs) pushMsg(convo, { from: "customer", text: m.display || m.text || "", kind: m.kind });
  convo.unread = (convo.unread || 0) + msgs.length;

  const ctx = { cfg, convo, t: transport, sim, catalog: null };
  try {
    if (!cfg.bot.enabled || isBotPaused(convo)) return;
    if (convo.botPausedUntil && convo.botPausedUntil <= Date.now()) {
      convo.botPausedUntil = 0;
      convo.needsHuman = false;
    }
    ctx.catalog = await loadCatalog();
    const st = convo.state;

    // 1) ¿Comprobante de pago?
    const mediaMsg = msgs.find((m) => ["image", "document"].includes(m.kind));
    if (mediaMsg && st.activeOrderId && ["esperando_pago", "pago_por_verificar"].includes(st.activeOrderStatus)) {
      const handled = await handleReceipt(ctx, mediaMsg);
      if (handled) return;
    }

    // 2) Botones especiales del flujo
    const special = [...msgs].reverse().map((m) => m.buttonId).find((id) => id && SPECIAL.has(id));
    if (special) {
      const done = await handleSpecial(ctx, special);
      if (done) return;
    }

    // 3) Conversación con IA
    await aiTurn(ctx, msgs);
  } catch (e) {
    console.error("Error del bot:", e);
    await notifyOwner(cfg, { type: "error", title: "Error del bot", body: `Cliente: ${convo.name || ""} (${waId})\n${e.message}`, waId, sim });
  } finally {
    await saveConvo(convo);
  }
}

// ---------- Botones del flujo de compra ----------
async function handleSpecial(ctx, id) {
  const { cfg, convo } = ctx;
  const st = convo.state;
  switch (id) {
    case "HUMAN":
      await say(ctx.t, convo, { text: "¡Claro! 🙌 Ya le avisé a un asesor y te escribe en breve por aquí." });
      await handoff(ctx, "El cliente pidió hablar con un asesor");
      return true;
    case "PAY_FULL":
    case "PAY_DEPOSIT":
      if (!st.cart.length) return false;
      st.paymentMethod = id === "PAY_FULL" ? "total" : "anticipo";
      st.checkout = true;
      if (missingFields(cfg, st.customer).length) return false; // la IA pide los datos
      await sendSummary(ctx);
      return true;
    case "CONFIRM":
      return confirmOrder(ctx);
    case "EDIT":
      st.paymentMethod = null;
      st.checkout = false;
      st.summaryHash = null;
      st.payChoiceHash = null;
      return false; // la IA pregunta qué modificar
    case "PAID":
      await say(ctx.t, convo, {
        text: "¡Excelente! 📸 Enviame por aquí la *foto o captura del comprobante* y lo verificamos de inmediato.",
        buttons: [{ id: "T:Lo envío en un rato", title: "Lo envío en un rato" }, { id: "HUMAN", title: "Hablar con asesor" }],
      });
      return true;
  }
  return false;
}

async function handoff(ctx, reason) {
  const { cfg, convo } = ctx;
  const already = convo.needsHuman;
  convo.needsHuman = true;
  convo.humanReason = reason || "";
  if (cfg.bot.handoffPausesBot) convo.botPausedUntil = Date.now() + (Number(cfg.bot.handoffPauseHours) || 6) * 3600 * 1000;
  if (already) return;
  const recent = convo.messages.slice(-6).map((m) => `${m.from === "customer" ? "👤" : "🤖"} ${m.text}`).join("\n");
  const cart = convo.state.cart.length ? `\n\n🛒 Carrito:\n${itemsText(convo.state.cart, cfg.business.currency)}` : "";
  await notifyOwner(cfg, {
    type: "human",
    title: `🆘 ${convo.name || "Un cliente"} necesita tu ayuda`,
    body: `📱 +${convo.waId}\nMotivo: ${reason || "—"}${cart}\n\nÚltimos mensajes:\n${recent}`,
    waId: convo.waId,
    sim: ctx.sim,
  });
}

function sendPaymentChoice(ctx) {
  const { cfg, convo } = ctx;
  const st = convo.state;
  const p = cfg.payments;
  const cur = cfg.business.currency || "$";
  const full = computeTotals(st.cart, "total", p);
  const dep = computeTotals(st.cart, "anticipo", p);
  const opts = [];
  const lines = [];
  if (p.fullEnabled) {
    opts.push({ id: "PAY_FULL", title: "💳 Pago completo" });
    lines.push(`💳 *Pago completo por transferencia:* ${money(full.total, cur)}${p.freeShippingOnFull && Number(p.shippingCost) ? " — ¡envío GRATIS! 🎁" : ""}`);
  }
  if (p.depositEnabled && dep.total > dep.payNow) {
    opts.push({ id: "PAY_DEPOSIT", title: `💵 Anticipo ${money(dep.payNow, cur)}` });
    lines.push(`💵 *Anticipo:* pagás ${money(dep.payNow, cur)} ahora y ${money(dep.payOnDelivery, cur)} contra entrega${dep.shipping ? ` (incluye envío ${money(dep.shipping, cur)})` : ""}`);
  }
  if (opts.length <= 1) {
    st.paymentMethod = opts[0]?.id === "PAY_DEPOSIT" ? "anticipo" : "total";
    return sendSummary(ctx);
  }
  st.payChoiceHash = hashOf(st.cart);
  const n = firstName(convo);
  return say(ctx.t, convo, {
    text: `¡Perfecto${n ? `, ${n}` : ""}! 🙌 Ya tengo todo. ¿Cómo preferís pagar?\n\n${lines.join("\n\n")}`,
    buttons: opts,
  });
}

function sendSummary(ctx) {
  const { cfg, convo } = ctx;
  const st = convo.state;
  const totals = computeTotals(st.cart, st.paymentMethod, cfg.payments);
  st.summaryHash = hashOf([st.cart, st.paymentMethod, st.customer]);
  return say(ctx.t, convo, {
    text: summaryText(cfg, { items: st.cart, method: st.paymentMethod, totals, customer: st.customer }) + "\n\n¿Confirmamos tu pedido o querés modificar algo?",
    buttons: [{ id: "CONFIRM", title: "✅ Confirmar pedido" }, { id: "EDIT", title: "✏️ Modificar" }],
  });
}

async function confirmOrder(ctx) {
  const { cfg, convo } = ctx;
  const st = convo.state;
  if (!st.cart.length) return false;
  if (missingFields(cfg, st.customer).length) {
    st.checkout = true;
    return false;
  }
  if (!st.paymentMethod) {
    await sendPaymentChoice(ctx);
    return true;
  }
  // Re-verificar disponibilidad
  const gone = [];
  st.cart = st.cart.filter((it) => {
    const v = ctx.catalog.variants.find((x) => x.sku === it.sku);
    if (v && !isAvailable(v)) { gone.push(it); return false; }
    if (v) it.price = v.price;
    return true;
  });
  if (gone.length) {
    await say(ctx.t, convo, {
      text: `😔 Lo siento, se acaba de agotar: ${gone.map((g) => `*${g.product}${g.label ? ` (${g.label})` : ""}*`).join(", ")}.\n\n¿Querés elegir otra opción o seguimos con el resto?`,
      buttons: [{ id: "T:Elegir otra opción", title: "Elegir otra opción" }, { id: st.cart.length ? "CONFIRM" : "T:Ver catálogo", title: st.cart.length ? "Seguir con el resto" : "Ver catálogo" }],
    });
    return true;
  }
  const totals = computeTotals(st.cart, st.paymentMethod, cfg.payments);
  const order = {
    id: uid(12),
    code: orderCode(cfg.business.orderPrefix),
    waId: convo.waId,
    name: convo.name,
    sim: ctx.sim,
    createdAt: Date.now(),
    status: "esperando_pago",
    items: st.cart.map((x) => ({ ...x })),
    method: st.paymentMethod,
    ...totals,
    customer: { ...st.customer },
    receipts: [],
    history: [{ at: Date.now(), action: "created" }],
    notes: "",
  };
  await saveOrder(order);
  st.activeOrderId = order.id;
  st.activeOrderCode = order.code;
  st.activeOrderStatus = order.status;
  st.cart = [];
  st.checkout = false;
  st.paymentMethod = null;
  st.summaryHash = null;
  st.payChoiceHash = null;
  await say(ctx.t, convo, {
    text: paymentInstructions(cfg, order),
    buttons: [{ id: "PAID", title: "📸 Ya pagué" }, { id: "T:Tengo una duda", title: "Tengo una duda" }],
  });
  const cur = cfg.business.currency || "$";
  await notifyOwner(cfg, {
    type: "order_new",
    title: `🛒 Nuevo pedido ${order.code}`,
    body: `${convo.name || ""} (+${convo.waId})\n\n${itemsText(order.items, cur)}\n\nTotal: ${money(order.total, cur)} · ${order.method === "anticipo" ? `Anticipo ${money(order.payNow, cur)} + ${money(order.payOnDelivery, cur)} contra entrega` : "Pago completo"}\nEstado: esperando comprobante\n\n${customerText(cfg, order.customer)}`,
    waId: convo.waId,
    orderId: order.id,
    sim: ctx.sim,
  });
  return true;
}

// ---------- Comprobantes ----------
async function handleReceipt(ctx, m) {
  const { cfg, convo } = ctx;
  const st = convo.state;
  const order = await loadOrder(st.activeOrderId);
  if (!order) return false;
  const cur = cfg.business.currency || "$";
  let media = null, analysis = null, key = null;
  try {
    media = await ctx.t.media(m.mediaId, m.inline);
  } catch (e) {
    console.error("No se pudo descargar comprobante", e.message);
  }
  if (media) {
    key = `r/${order.id}/${Date.now()}`;
    await setBinary("media", key, media.data);
    try {
      analysis = await analyzeReceipt({ cfg, mime: media.mime, base64: media.data.toString("base64"), expected: money(order.payNow, cur) });
    } catch { analysis = null; }
  }
  if (analysis && analysis.is_receipt === false && !/comprobante|pago|transfer|deposit/i.test(m.text || "")) return false;
  order.receipts = order.receipts || [];
  order.receipts.push({ key, mime: media?.mime || m.mime || "image/jpeg", at: Date.now(), analysis, caption: m.text || "" });
  order.status = "pago_por_verificar";
  order.history.push({ at: Date.now(), action: "receipt" });
  await saveOrder(order);
  st.activeOrderStatus = order.status;
  await say(ctx.t, convo, {
    text: `¡Recibido! 🙌 Ya estamos verificando tu pago del pedido *${order.code}*. Te confirmo por aquí en cuanto quede listo ✅`,
    buttons: [{ id: "T:Ver mi pedido", title: "Ver mi pedido" }, { id: "HUMAN", title: "Hablar con asesor" }],
  });
  let det = "";
  if (analysis) {
    const ok = analysis.amount != null && Math.abs(Number(analysis.amount) - order.payNow) < 0.01;
    det = `\n\n🤖 Lectura automática: ${analysis.is_receipt ? "parece un comprobante" : "NO parece comprobante"}${analysis.amount != null ? `\nMonto: ${money(analysis.amount, cur)} ${ok ? "✅ coincide" : `⚠️ esperado ${money(order.payNow, cur)}`}` : ""}${analysis.bank ? `\nBanco: ${analysis.bank}` : ""}${analysis.reference ? `\nRef.: ${analysis.reference}` : ""}${analysis.date ? `\nFecha: ${analysis.date}` : ""}`;
  }
  await notifyOwner(cfg, {
    type: "payment",
    title: `💰 Comprobante recibido — ${order.code}`,
    body: `${convo.name || ""} (+${convo.waId})\nDebe pagar ahora: ${money(order.payNow, cur)}${order.payOnDelivery ? ` (y ${money(order.payOnDelivery, cur)} contra entrega)` : ""}\n\n${itemsText(order.items, cur)}${det}\n\nRevisá el comprobante en el panel y confirmá.`,
    waId: convo.waId,
    orderId: order.id,
    sim: ctx.sim,
    buttons: [{ id: `ADM_OK:${order.id}`, title: "✅ Confirmar pago" }, { id: `ADM_NO:${order.id}`, title: "❌ Rechazar" }],
  });
  return true;
}

// ---------- Turno con IA ----------
function stateText(cfg, convo) {
  const st = convo.state;
  const cur = cfg.business.currency || "$";
  const lines = [];
  lines.push(`- Nombre de perfil de WhatsApp: ${convo.name || "(desconocido)"}`);
  lines.push(`- Carrito: ${st.cart.length ? "\n" + st.cart.map((it, i) => `   ${i + 1}) ${it.product}${it.label ? ` (${it.label})` : ""} x${it.qty} — ${money(it.price * it.qty, cur)}`).join("\n") : "(vacío)"}`);
  const have = cfg.customerFields.filter((f) => st.customer?.[f.key]).map((f) => `${f.label}: ${st.customer[f.key]}`);
  lines.push(`- Datos de envío ya recibidos: ${have.length ? have.join(" | ") : "(ninguno)"}`);
  const miss = missingFields(cfg, st.customer);
  lines.push(`- DATOS FALTANTES (obligatorios): ${miss.length ? miss.map((f) => f.label).join(", ") : "ninguno ✔"}`);
  const opt = cfg.customerFields.filter((f) => !f.required && !st.customer?.[f.key]);
  if (opt.length) lines.push(`- Datos opcionales (pedilos junto a los obligatorios, aclarando que son opcionales): ${opt.map((f) => f.label).join(", ")}`);
  lines.push(`- Quiere finalizar compra: ${st.checkout ? "sí" : "no"}`);
  lines.push(`- Forma de pago elegida: ${st.paymentMethod || "ninguna"}`);
  if (st.activeOrderId) lines.push(`- Pedido anterior/activo: ${st.activeOrderCode} — estado: ${STATUS_LABEL[st.activeOrderStatus] || st.activeOrderStatus}`);
  return lines.join("\n");
}

function defaultButtons(cfg, st) {
  if (st.checkout && st.cart.length && !missingFields(cfg, st.customer).length && !st.paymentMethod) {
    const b = [];
    if (cfg.payments.fullEnabled) b.push({ id: "PAY_FULL", title: "💳 Pago completo" });
    if (cfg.payments.depositEnabled) b.push({ id: "PAY_DEPOSIT", title: `💵 Anticipo ${money(cfg.payments.depositAmount, cfg.business.currency)}` });
    if (b.length === 2) return b;
  }
  if (st.checkout && st.cart.length && !missingFields(cfg, st.customer).length && st.paymentMethod)
    return [{ id: "CONFIRM", title: "✅ Confirmar pedido" }, { id: "EDIT", title: "✏️ Modificar" }];
  if (st.activeOrderStatus === "esperando_pago" && !st.cart.length)
    return [{ id: "PAID", title: "📸 Ya pagué" }, { id: "HUMAN", title: "Hablar con asesor" }];
  if (st.cart.length) return [{ id: "T:Finalizar pedido", title: "Finalizar pedido" }, { id: "T:Seguir viendo", title: "Seguir viendo" }];
  return [{ id: "T:Ver catálogo", title: "Ver catálogo" }, { id: "HUMAN", title: "Hablar con asesor" }];
}

async function buildUserParts(ctx, msgs) {
  const parts = [];
  for (const m of msgs) {
    if (["image", "audio", "document", "video"].includes(m.kind) && (m.mediaId || m.inline)) {
      try {
        const media = await ctx.t.media(m.mediaId, m.inline);
        if (media.data.length < 15 * 1024 * 1024 && /^(image|audio|application\/pdf)/.test(media.mime)) {
          parts.push({ inlineData: { mimeType: media.mime.split(";")[0], data: media.data.toString("base64") } });
        }
      } catch (e) {
        console.error("media", e.message);
      }
      const label = { image: "[El cliente envió una imagen]", audio: "[El cliente envió un audio: respondé a lo que dice]", document: "[El cliente envió un documento]", video: "[El cliente envió un video]" }[m.kind];
      parts.push({ text: m.text ? `${label} ${m.text}` : label });
    } else {
      parts.push({ text: m.text || m.display || "(mensaje vacío)" });
    }
  }
  return parts;
}

async function aiTurn(ctx, msgs) {
  const { cfg, convo, catalog } = ctx;
  const st = convo.state;
  const history = convo.messages.slice(0, -msgs.length).slice(-16);
  const userParts = await buildUserParts(ctx, msgs);
  let ai;
  try {
    ai = await askSalesAI({
      cfg,
      catalogText: catalogForAI(catalog, cfg.business.currency),
      stateText: stateText(cfg, convo),
      attributes: catalog.attributes || [],
      history,
      userParts,
    });
  } catch (e) {
    console.error("IA falló:", e.message);
    await say(ctx.t, convo, {
      text: "¡Disculpá! 🙏 Tuve un pequeño problema técnico. ¿Lo intentamos de nuevo o preferís que te atienda un asesor?",
      buttons: [{ id: "T:Intentar de nuevo", title: "Intentar de nuevo" }, { id: "HUMAN", title: "Hablar con asesor" }],
    });
    await notifyOwner(cfg, { type: "error", title: "La IA no respondió", body: `Cliente +${convo.waId}\n${e.message}`, waId: convo.waId, sim: ctx.sim });
    return;
  }

  // Datos del cliente
  if (ai.customer && typeof ai.customer === "object") {
    for (const f of cfg.customerFields) {
      const v = ai.customer[f.key];
      if (v && String(v).trim() && !/^(null|n\/a|ninguno|no aplica|-)$/i.test(String(v).trim())) st.customer[f.key] = String(v).trim();
    }
  }

  // Carrito
  const notes = [];
  let forcedButtons = null;
  let forcedList = null;
  if (ai.cart_clear) st.cart = [];
  if (Array.isArray(ai.cart_remove) && ai.cart_remove.length) {
    [...new Set(ai.cart_remove)].sort((a, b) => b - a).forEach((n) => { if (n >= 1 && n <= st.cart.length) st.cart.splice(n - 1, 1); });
  }
  for (const add of ai.cart_add || []) {
    const r = resolveVariant(catalog, add.product, add.options);
    const qty = Math.max(1, Math.min(99, parseInt(add.qty, 10) || 1));
    if (!r.error && r.variant) {
      const ex = st.cart.find((x) => x.sku === r.variant.sku);
      if (ex) ex.qty = qty > ex.qty ? qty : ex.qty;
      else st.cart.push({ sku: r.variant.sku, product: r.variant.product, label: r.label, price: r.variant.price, qty, image: r.variant.image || "" });
    } else if (r.error === "missing") {
      notes.push(`👉 Para apartar *${r.product}* me falta saber: ${r.missing.map((a) => `*${a}* (${r.values[a].slice(0, 8).join(", ")})`).join(" y ")}.`);
      if (r.missing.length === 1) {
        const vals = r.values[r.missing[0]];
        if (vals.length <= 3) forcedButtons = vals.map((v) => ({ id: `T:${v}`, title: v }));
        else if (vals.length <= 10) forcedList = { button: `Elegir ${r.missing[0]}`.slice(0, 20), title: r.missing[0], rows: vals.map((v, i) => ({ id: `L:${i}`, title: v })) };
      }
    } else if (r.error === "unavailable") {
      notes.push(`😔 *${r.product}${r.label ? ` (${r.label})` : ""}* está agotado por ahora.`);
    } else if (r.error === "combo_not_found") {
      notes.push(`😔 Esa combinación de *${r.product}* no la tenemos disponible.`);
    } else {
      notes.push(`No encontré "${add.product}" en el catálogo 🤔`);
    }
  }
  if (ai.wants_checkout) st.checkout = true;
  if (ai.payment_method === "total" || ai.payment_method === "anticipo") st.paymentMethod = ai.payment_method;
  if (!st.cart.length) st.paymentMethod = null;

  let reply = String(ai.reply || "").trim();
  if (notes.length) reply = [reply, notes.join("\n")].filter(Boolean).join("\n\n");
  const images = productImages(catalog, ai.send_images || []);

  // Pasar a un asesor
  if (ai.needs_human) {
    await say(ctx.t, convo, { text: reply || "Ya le avisé a un asesor 🙌 Te escribe en breve.", images });
    await handoff(ctx, ai.human_reason || "La IA detectó que necesita ayuda humana");
    return;
  }

  // Avance automático del cierre de venta
  if (st.checkout && st.cart.length && !notes.length && !missingFields(cfg, st.customer).length) {
    if (!st.paymentMethod && st.payChoiceHash !== hashOf(st.cart)) {
      if (reply) await say(ctx.t, convo, { text: reply, images });
      await sendPaymentChoice(ctx);
      return;
    }
    if (st.paymentMethod && st.summaryHash !== hashOf([st.cart, st.paymentMethod, st.customer])) {
      if (reply) await say(ctx.t, convo, { text: reply, images });
      await sendSummary(ctx);
      return;
    }
  }

  // Respuesta normal: siempre con doble alternativa
  let list = forcedList;
  if (!list && ai.show_list?.items?.length) {
    list = { button: ai.show_list.button || "Ver opciones", title: "Opciones", rows: ai.show_list.items.slice(0, 10).map((it, i) => ({ id: `L:${i}`, title: it.title, description: it.description })) };
  }
  let buttons = forcedButtons || (ai.buttons || []).filter(Boolean).map((b) => ({ id: `T:${String(b).slice(0, 20)}`, title: String(b) }));
  if (!list) {
    // Mapear botones con significado especial
    buttons = buttons.map((b) => {
      const n = norm(b.title);
      if (/asesor|persona|humano/.test(n)) return { ...b, id: "HUMAN" };
      if (/^(✅ )?confirmar/.test(n) && st.summaryHash) return { ...b, id: "CONFIRM" };
      if (/ya pague/.test(n) && st.activeOrderId) return { ...b, id: "PAID" };
      if (st.cart.length && st.checkout && /pago completo|100|transferencia completa/.test(n)) return { ...b, id: "PAY_FULL" };
      if (st.cart.length && st.checkout && /anticipo/.test(n)) return { ...b, id: "PAY_DEPOSIT" };
      return b;
    });
    if (buttons.length < 2) {
      for (const d of defaultButtons(cfg, st)) {
        if (buttons.length >= 2) break;
        if (!buttons.find((b) => norm(b.title) === norm(d.title))) buttons.push(d);
      }
    }
  } else buttons = [];
  if (!reply) reply = list ? "Mirá estas opciones 👇" : "¿Qué preferís?";
  await say(ctx.t, convo, { text: reply, buttons, list, images });
}

// ---------- Comandos del dueño desde su WhatsApp personal ----------
async function handleOwner({ cfg, waId, msgs, t }) {
  const reply = (text, buttons) => (buttons ? t.buttons(waId, text, buttons) : t.text(waId, text));
  for (const m of msgs) {
    const id = m.buttonId || "";
    const text = (m.text || "").trim();
    try {
      let mo;
      if (id.startsWith("ADM_OK:") || id.startsWith("ADM_NO:")) {
        const action = id.startsWith("ADM_OK:") ? "confirm" : "reject";
        const { order, sendErrors } = await applyOrderAction(cfg, id.slice(7), action);
        await reply(`${action === "confirm" ? "✅ Pago confirmado" : "❌ Comprobante rechazado"} — ${order.code}. ${sendErrors.length ? "⚠️ No se pudo avisar al cliente: " + sendErrors[0] : "Ya le avisé al cliente."}`);
      } else if ((mo = text.match(/^(confirmar|ok|rechazar|enviado|entregado|cancelar)\s+#?(\S+)/i))) {
        const map = { confirmar: "confirm", ok: "confirm", rechazar: "reject", enviado: "ship", entregado: "deliver", cancelar: "cancel" };
        const order = await findOrderByCode(mo[2]);
        if (!order) await reply(`No encontré el pedido ${mo[2]}.`);
        else {
          const r = await applyOrderAction(cfg, order.id, map[mo[1].toLowerCase()]);
          await reply(`Listo: ${order.code} → ${STATUS_LABEL[r.order.status]}${r.sendErrors.length ? " (⚠️ no se pudo avisar al cliente)" : ""}`);
        }
      } else if (/^pedidos/i.test(text)) {
        const pend = (await listOrders()).filter((o) => !o.sim && ["esperando_pago", "pago_por_verificar", "confirmado"].includes(o.status)).slice(0, 15);
        await reply(pend.length ? "📋 *Pedidos activos*\n\n" + pend.map((o) => `${o.code} · ${o.customer?.nombre || o.name} · ${money(o.total)} · ${STATUS_LABEL[o.status]}`).join("\n") : "No hay pedidos activos 🙌");
      } else if ((mo = text.match(/^(pausar|activar)\s+\+?(\d{8,15})/i))) {
        const c = await loadConvo(mo[2]);
        if (!c) await reply("No encontré esa conversación.");
        else {
          const pause = mo[1].toLowerCase() === "pausar";
          c.botPaused = pause;
          c.botPausedUntil = 0;
          if (!pause) c.needsHuman = false;
          await saveConvo(c);
          await reply(`Bot ${pause ? "⏸️ pausado" : "▶️ activado"} para +${mo[2]}.`);
        }
      } else {
        await reply(
          "👋 Hola, jefe. Avisos activados por 24 h.\n\nComandos:\n• *pedidos* — ver pedidos activos\n• *confirmar CÓDIGO* — confirmar pago\n• *rechazar CÓDIGO*\n• *enviado CÓDIGO* / *entregado CÓDIGO*\n• *pausar 503XXXXXXXX* / *activar 503XXXXXXXX*"
        );
      }
    } catch (e) {
      await reply(`⚠️ ${e.message}`).catch(() => {});
    }
  }
}
