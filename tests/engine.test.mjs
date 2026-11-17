// Prueba del flujo completo con IA simulada (no usa internet). Ejecutar: npm test
process.env.BOT_MEMORY_STORE = "1";
const { saveConfig, loadConfig } = await import("../netlify/lib/config.mjs");
const { saveCatalog } = await import("../netlify/lib/catalog.mjs");
const { handleInbound } = await import("../netlify/lib/engine.mjs");
const { simClient } = await import("../netlify/lib/whatsapp.mjs");
const { listOrders, loadConvo, listNotifs } = await import("../netlify/lib/data.mjs");
const { applyOrderAction } = await import("../netlify/lib/orders.mjs");

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.log("  ❌", msg); } else console.log("  ✅", msg); };

// IA falsa: devuelve respuestas en cola
const queue = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("generativelanguage")) {
    const body = JSON.parse(opts.body);
    const isReceipt = JSON.stringify(body).includes("comprobante de pago, transferencia");
    const payload = isReceipt ? { is_receipt: true, amount: 5, bank: "Banco Agrícola" } : queue.shift();
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
};

await saveConfig({ connections: { geminiKey: "test" }, business: { name: "NYXAR", orderPrefix: "NX" }, payments: { accounts: [{ bank: "Banco Agrícola", type: "Ahorro", number: "3001234567", holder: "Tienda" }] } });
const variants = [];
for (const corte of ["Regular", "Oversize", "Boxy fit"]) for (const talla of ["XS", "S", "M", "L", "XL"])
  variants.push({ sku: `AJ-${corte[0]}-${talla}`, product: "Camisa Ajedrez", category: "Camisas", price: 25, attrs: { Corte: corte, Talla: talla, Color: "Blanco" }, stockMode: corte === "Oversize" && talla === "XL" ? "agotado" : "ilimitado" });
variants.push({ sku: "BOL-1", product: "Bolso Luna", category: "Bolsos", price: 30, attrs: { Color: "Negro" }, stockMode: "cantidad", stock: 2 });
await saveCatalog({ attributes: ["Corte", "Talla", "Color"], variants });
const cfg = await loadConfig();

async function send(text, extra = {}) {
  const t = simClient();
  await handleInbound({ waId: "50370000000", name: "Juan", msgs: [{ kind: extra.kind || "text", text, ...extra }], transport: t, sim: true, cfg });
  for (const o of t.outputs) console.log(`     🤖 [${o.type}] ${(o.text || o.caption || "").replace(/\n+/g, " ¶ ")}${o.buttons ? "  ⟶ " + o.buttons.map((b) => `${b.title}(${b.id})`).join(" | ") : ""}`);
  return t.outputs;
}

console.log("1) Saludo");
queue.push({ reply: "¡Hola! ¿Buscás camisas o bolsos?", buttons: ["Camisas", "Bolsos"] });
let out = await send("hola");
assert(out[0].type === "buttons" && out[0].buttons.length === 2, "responde con doble alternativa");

console.log("2) Variante incompleta");
queue.push({ reply: "¡Buena elección!", buttons: [], cart_add: [{ product: "camisa ajedrez", options: [{ name: "Corte", value: "oversize" }], qty: 1 }] });
out = await send("quiero la de ajedrez oversize");
assert(/me falta saber/.test(out[0].text) && out[0].type === "list" && out[0].sections[0].rows.length === 5, "pide la talla que falta con lista de opciones");

console.log("3) Variante agotada");
queue.push({ reply: "Va", buttons: ["A", "B"], cart_add: [{ product: "Camisa Ajedrez", options: [{ name: "Corte", value: "Oversize" }, { name: "Talla", value: "XL" }] }] });
out = await send("XL");
assert(/agotado/.test(out[0].text), "avisa que está agotada");

console.log("4) Agregar y pedir checkout");
queue.push({ reply: "¡Listo! Pasame tus datos: nombre, teléfono...", buttons: ["Ya te los mando", "Tengo una duda"], cart_add: [{ product: "Camisa Ajedrez", options: [{ name: "Corte", value: "Oversize" }, { name: "Talla", value: "M" }] }], wants_checkout: true });
out = await send("entonces M, la quiero");
let c = await loadConvo("50370000000");
assert(c.state.cart.length === 1 && c.state.cart[0].price === 25, "carrito con 1 camisa de $25");

console.log("5) Datos completos → formas de pago");
queue.push({ reply: "¡Gracias, Juan!", buttons: [], customer: { nombre: "Juan Pérez", telefono: "70000000", departamento: "San Salvador", municipio: "Mejicanos", direccion: "Col. X, casa 5", referencia: "Frente al parque" } });
out = await send("Juan Pérez, 70000000, San Salvador, Mejicanos, Col. X casa 5, frente al parque");
const pay = out.find((o) => o.buttons?.some((b) => b.id === "PAY_DEPOSIT"));
assert(pay && /\$25\.00/.test(pay.text) && /\$23\.00/.test(pay.text), "ofrece pago completo $25 (envío gratis) o anticipo $5 + $23 contra entrega");

console.log("6) Elige anticipo → resumen");
out = await send("💵 Anticipo $5.00", { kind: "button", buttonId: "PAY_DEPOSIT" });
assert(/Total: \$28\.00/.test(out[0].text) && out[0].buttons[0].id === "CONFIRM", "resumen total $28 con botón Confirmar");

console.log("7) Confirmar → pedido + datos bancarios");
out = await send("✅ Confirmar pedido", { kind: "button", buttonId: "CONFIRM" });
assert(/3001234567/.test(out[0].text) && /\$5\.00/.test(out[0].text), "envía cuenta bancaria y monto $5");
let orders = await listOrders();
assert(orders.length === 1 && orders[0].total === 28 && orders[0].payOnDelivery === 23, "pedido creado: total 28, contra entrega 23");

console.log("8) Comprobante");
out = await send("", { kind: "image", inline: { mime: "image/png", base64: Buffer.from("fake").toString("base64") } });
orders = await listOrders();
assert(orders[0].status === "pago_por_verificar" && orders[0].receipts.length === 1, "pedido pasa a 'pago por verificar'");
const notifs = await listNotifs();
assert(notifs.some((n) => n.type === "payment") && notifs.some((n) => n.type === "order_new"), "notificaciones de pedido nuevo y de pago");

console.log("9) Dueño confirma");
await applyOrderAction(cfg, orders[0].id, "confirm");
c = await loadConvo("50370000000");
assert(c.state.activeOrderStatus === "confirmado" && /Pago confirmado/.test(c.messages.at(-1).text), "cliente recibe confirmación");

console.log("10) Pedir asesor");
queue.push({ reply: "Ya le aviso a un asesor", buttons: [], needs_human: true, human_reason: "Quiere precio de mayoreo" });
out = await send("quiero 50 camisas a precio de mayoreo");
c = await loadConvo("50370000000");
assert(c.needsHuman && c.botPausedUntil > Date.now(), "marca 'necesita ayuda' y pausa el bot");

console.log("11) Stock por cantidad (otro cliente, pago completo)");
const t2 = async (text, extra = {}) => { const t = simClient(); await handleInbound({ waId: "50371111111", name: "Ana", msgs: [{ kind: extra.kind || "text", text, ...extra }], transport: t, sim: true, cfg }); return t.outputs; };
queue.push({ reply: "¡Listo!", buttons: [], cart_add: [{ product: "Bolso Luna", options: [], qty: 1 }], wants_checkout: true, customer: { nombre: "Ana López", telefono: "71111111", departamento: "La Libertad", municipio: "Santa Tecla", direccion: "Calle 1", referencia: "Iglesia" } });
out = await t2("quiero el bolso luna, soy Ana López 71111111 La Libertad Santa Tecla Calle 1 frente a iglesia");
out = await t2("💳 Pago completo", { kind: "button", buttonId: "PAY_FULL" });
assert(/Total: \$30\.00/.test(out[0].text) && /GRATIS/.test(out[0].text), "pago completo: envío gratis, total $30");
out = await t2("✅ Confirmar pedido", { kind: "button", buttonId: "CONFIRM" });
orders = await listOrders();
const ana = orders.find((o) => o.waId === "50371111111");
await applyOrderAction(cfg, ana.id, "confirm");
const { loadCatalog } = await import("../netlify/lib/catalog.mjs");
const cat = await loadCatalog();
assert(cat.variants.find((v) => v.sku === "BOL-1").stock === 1, "descuenta stock (2 → 1)");

console.log(failures ? `\n${failures} prueba(s) fallaron` : "\nTodas las pruebas pasaron ✅");
process.exit(failures ? 1 : 0);
