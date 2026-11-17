// Servidor local para probar el panel sin Netlify (datos en memoria, IA falsa si FAKE_AI=1)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.BOT_MEMORY_STORE = "1";
process.env.ADMIN_PASSWORD ||= "test";
process.env.FAKE_AI ||= "1";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = (await import("../netlify/functions/api.mjs")).default;
const webhook = (await import("../netlify/functions/webhook.mjs")).default;

if (process.env.FAKE_AI === "1") {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes("generativelanguage")) return realFetch(url, opts);
    const body = JSON.parse(opts.body);
    const last = body.contents.at(-1).parts.map((p) => p.text || "").join(" ").toLowerCase();
    let r;
    if (body.contents.length === 1 && last.includes("comprobante de pago")) r = { is_receipt: true, amount: 5, bank: "Banco Agrícola", reference: "123456" };
    else if (/hola|buenas/.test(last)) r = { reply: "¡Hola! 👋 Bienvenido a *NYXAR*. Tenemos camisas en corte Regular, Oversize y Boxy fit. ¿Querés ver el catálogo de camisas o el de bolsos?", buttons: [], show_list: { button: "Ver catálogo", items: [{ title: "Camisa Ajedrez", description: "Desde $25 · Regular, Oversize, Boxy fit" }, { title: "Bolso Luna", description: "$30 · Negro" }] } };
    else if (/ajedrez/.test(last)) r = { reply: "¡Buena elección! 🔥 La *Camisa Ajedrez* cuesta $25.", buttons: [], cart_add: [{ product: "Camisa Ajedrez", options: [{ name: "Corte", value: "Oversize" }], qty: 1 }] };
    else if (/^\s*(xs|s|m|l|xl)\s*$/.test(last.replace(/[^a-z ]/g, ""))) r = { reply: `¡Listo! Te aparté la Oversize talla ${last.trim().toUpperCase()} 🙌 ¿La pedimos ya o querés ver algo más?`, buttons: ["Finalizar pedido", "Seguir viendo"], cart_add: [{ product: "Camisa Ajedrez", options: [{ name: "Corte", value: "Oversize" }, { name: "Talla", value: last.trim() }] }] };
    else if (/finalizar/.test(last)) r = { reply: "¡Perfecto! Para el envío mandame:\n• Nombre y apellido\n• Teléfono\n• Departamento y municipio\n• Dirección exacta\n• Punto de referencia\n• Comentario (opcional)", buttons: ["Ya te los mando", "Tengo una duda"], wants_checkout: true };
    else if (/,/.test(last)) r = { reply: "¡Gracias! Ya tengo tus datos ✅", buttons: [], customer: { nombre: "Juan Pérez", telefono: "70000000", departamento: "San Salvador", municipio: "Mejicanos", direccion: "Col. Zacamil, casa 5", referencia: "Frente al parque" } };
    else r = { reply: "¡Claro! ¿Querés ver camisas o bolsos?", buttons: ["Camisas", "Bolsos"] };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(r) }] } }] }), { status: 200 });
  };
  // Catálogo y ajustes de ejemplo
  const { saveCatalog } = await import("../netlify/lib/catalog.mjs");
  const { saveConfig } = await import("../netlify/lib/config.mjs");
  const variants = [];
  for (const c of ["Regular", "Oversize", "Boxy fit"]) for (const t of ["XS", "S", "M", "L", "XL"]) variants.push({ sku: `AJ-${c[0]}-${t}`, product: "Camisa Ajedrez", category: "Camisas", price: 25, attrs: { Corte: c, Talla: t, Color: "Blanco" }, stockMode: c === "Oversize" && t === "XL" ? "agotado" : "ilimitado" });
  variants.push({ sku: "BOL", product: "Bolso Luna", category: "Bolsos", price: 30, attrs: { Color: "Negro" }, stockMode: "cantidad", stock: 3 });
  await saveCatalog({ attributes: ["Corte", "Talla", "Color"], variants });
  await saveConfig({ business: { name: "NYXAR", orderPrefix: "NX" }, connections: { geminiKey: "fake", verifyToken: "secreto" }, payments: { accounts: [{ bank: "Banco Agrícola", type: "Ahorro", number: "3001234567", holder: "Williams" }] } });
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8888");
  if (url.pathname.startsWith("/api/") || url.pathname === "/webhook") {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const r = await (url.pathname === "/webhook" ? webhook : api)(request, {});
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const file = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file)) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(8888, () => console.log("Panel local: http://localhost:8888  (contraseña: " + process.env.ADMIN_PASSWORD + ")"));
