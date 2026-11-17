// IA: Google Gemini (gratis) con respaldo opcional en Groq (gratis, solo texto)
import { paymentExplanation } from "./config.mjs";

function responseSchema(fieldKeys) {
  const customerProps = {};
  for (const k of fieldKeys) customerProps[k] = { type: "STRING" };
  return {
    type: "OBJECT",
    properties: {
      reply: { type: "STRING" },
      buttons: { type: "ARRAY", items: { type: "STRING" } },
      show_list: {
        type: "OBJECT",
        properties: {
          button: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: { type: "OBJECT", properties: { title: { type: "STRING" }, description: { type: "STRING" } }, required: ["title"] },
          },
        },
      },
      cart_add: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            product: { type: "STRING" },
            options: {
              type: "ARRAY",
              items: { type: "OBJECT", properties: { name: { type: "STRING" }, value: { type: "STRING" } }, required: ["name", "value"] },
            },
            qty: { type: "INTEGER" },
          },
          required: ["product"],
        },
      },
      cart_remove: { type: "ARRAY", items: { type: "INTEGER" } },
      cart_clear: { type: "BOOLEAN" },
      customer: Object.keys(customerProps).length ? { type: "OBJECT", properties: customerProps } : { type: "OBJECT", properties: { nota: { type: "STRING" } } },
      wants_checkout: { type: "BOOLEAN" },
      payment_method: { type: "STRING", enum: ["total", "anticipo", "ninguno"] },
      send_images: { type: "ARRAY", items: { type: "STRING" } },
      needs_human: { type: "BOOLEAN" },
      human_reason: { type: "STRING" },
    },
    required: ["reply", "buttons"],
  };
}

export function buildSystemPrompt({ cfg, catalogText, stateText, attributes }) {
  const b = cfg.business;
  const p = cfg.payments;
  return `Sos el asistente de ventas por WhatsApp de "${b.name}". ${b.description || ""}
TONO: ${b.tone}
OBJETIVO: atender, asesorar y CERRAR ventas las 24 horas, como el mejor vendedor de la tienda.

REGLAS (obligatorias):
1. Respuestas cortas (máximo 5 líneas), naturales, con formato de WhatsApp (*negrita*, saltos de línea). No uses títulos con #.
2. Solo ofrecé productos, opciones y precios que existan en el CATÁLOGO. Jamás inventés precios, tallas, colores, descuentos, promociones ni tiempos de entrega.
3. SIEMPRE terminá con una pregunta de DOBLE ALTERNATIVA que lleve a la venta (ej.: "¿La preferís en corte Regular u Oversize?", "¿Te la aparto en M o en L?"). Nunca preguntés "¿te puedo ayudar en algo más?". En "buttons" devolvé exactamente esas 2 opciones (máx. 3), cada una de 20 caracteres o menos y sin repetir.
4. Para mostrar varios productos o categorías usá "show_list" (máx. 10 ítems; title ≤ 24 caracteres; description ≤ 72 con precio). Si usás show_list, "buttons" va vacío.
5. Agregá al carrito con "cart_add" SOLO cuando el cliente ya eligió el producto y TODAS sus opciones (${attributes.length ? attributes.join(", ") : "si las tiene"}). Usá el nombre exacto del producto y los valores exactos del catálogo. Si falta una opción, preguntala con doble alternativa. "cart_remove" usa el número de línea del carrito.
6. NO calculés totales, envíos ni anticipos: el sistema los calcula y se los muestra al cliente.
7. Cuando el cliente quiera comprar ("lo quiero", "cómo pago", "apartámela", "quiero pedir"), poné wants_checkout=true y pedí los DATOS DE ENVÍO que falten (ver ESTADO). La primera vez pedilos todos en un solo mensaje, en lista; después solo los que falten. Guardá en "customer" cualquier dato que el cliente mande, aunque venga mezclado. Mientras pedís datos, los botones pueden ser por ejemplo "Ya te los mando" y "Tengo una duda".
8. Si con este mensaje ya están TODOS los datos y hay productos en el carrito, solo confirmá brevemente que los recibiste y no hagás preguntas: el sistema enviará las formas de pago con botones.
9. FORMAS DE PAGO:
${paymentExplanation(cfg)}
   Si el cliente elige una, ponela en payment_method ("total" o "anticipo").
10. Si el cliente dice que ya pagó, pedile la foto o captura del comprobante.
11. needs_human=true (con human_reason) cuando: pida hablar con una persona, tenga un reclamo o problema con un pedido, pida descuento o precio por mayoreo, pregunte algo que no está en la información, o esté molesto. En ese caso decile que ya avisaste a un asesor y que le escribirá pronto.
12. Si el cliente manda un audio o imagen, respondé a su contenido. Si pide fotos de un producto que tiene foto, poné su nombre en "send_images".
13. Si el cliente saluda por primera vez, saludalo con calidez, presentá brevemente la tienda y preguntá con doble alternativa qué busca (podés mostrar las categorías con show_list).
${cfg.bot.extraInstructions ? "\nINSTRUCCIONES EXTRA DEL DUEÑO:\n" + cfg.bot.extraInstructions + "\n" : ""}
INFORMACIÓN DEL NEGOCIO:
- Saludo sugerido: ${b.greeting || "(libre)"}
- Horario: ${b.hours || "(no indicado)"}
- Tiempo de entrega: ${p.deliveryTime || "(no indicado)"}
- Políticas (cambios, devoluciones, etc.): ${b.policies || "(no indicadas: si preguntan, needs_human)"}
- Preguntas frecuentes: ${b.faq || "(ninguna)"}

CATÁLOGO (moneda ${b.currency || "$"}):
${catalogText}

ESTADO ACTUAL DE ESTE CLIENTE:
${stateText}`;
}

function toGeminiContents(history, userParts) {
  const contents = [];
  for (const m of history) {
    const role = m.from === "customer" ? "user" : "model";
    let text = m.text || "";
    if (m.from === "owner") text = `[Mensaje del asesor humano]: ${text}`;
    if (m.buttons?.length) text += `\n[Botones: ${m.buttons.join(" | ")}]`;
    if (!text) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push({ text });
    else contents.push({ role, parts: [{ text }] });
  }
  const last = contents[contents.length - 1];
  if (last && last.role === "user") last.parts.push(...userParts);
  else contents.push({ role: "user", parts: userParts });
  if (contents[0]?.role === "model") contents.unshift({ role: "user", parts: [{ text: "(inicio de conversación)" }] });
  return contents;
}

async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function geminiJSON({ key, model, system, contents, schema, timeoutMs = 7000, temperature = 0.5 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const generationConfig = { temperature, responseMimeType: "application/json" };
  if (schema) generationConfig.responseSchema = schema;
  if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const body = { contents, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const r = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }, timeoutMs);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Gemini ${r.status}: ${j?.error?.message || "error"}`);
    e.status = r.status;
    throw e;
  }
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return parseJSONLoose(text);
}

async function groqJSON({ key, model, system, history, userText, timeoutMs = 7000 }) {
  const messages = [{ role: "system", content: system + "\n\nResponde ÚNICAMENTE con un objeto JSON con las claves: reply, buttons, show_list, cart_add, cart_remove, cart_clear, customer, wants_checkout, payment_method, send_images, needs_human, human_reason." }];
  for (const m of history) {
    const role = m.from === "customer" ? "user" : "assistant";
    let content = m.text || "";
    if (m.buttons?.length) content += `\n[Botones: ${m.buttons.join(" | ")}]`;
    if (content) messages.push({ role, content });
  }
  messages.push({ role: "user", content: userText });
  const r = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.5, response_format: { type: "json_object" } }),
  }, timeoutMs);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Groq ${r.status}: ${j?.error?.message || "error"}`);
  return parseJSONLoose(j?.choices?.[0]?.message?.content || "");
}

function parseJSONLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("La IA no devolvió JSON válido");
  }
}

// Turno principal de la conversación
export async function askSalesAI({ cfg, catalogText, stateText, attributes, history, userParts }) {
  const conn = cfg.connections;
  const system = buildSystemPrompt({ cfg, catalogText, stateText, attributes });
  const schema = responseSchema(cfg.customerFields.map((f) => f.key));
  const contents = toGeminiContents(history, userParts);
  const errors = [];
  if (conn.geminiKey) {
    for (const model of [conn.geminiModel, conn.geminiFallbackModel].filter(Boolean)) {
      try {
        return await geminiJSON({ key: conn.geminiKey, model, system, contents, schema });
      } catch (e) {
        errors.push(e.message);
        if (e.status && ![429, 500, 503, 504].includes(e.status)) break;
      }
    }
  }
  if (conn.groqKey) {
    try {
      const userText = userParts.map((p) => p.text || (p.inlineData ? "[archivo adjunto que no puedo ver]" : "")).join("\n");
      return await groqJSON({ key: conn.groqKey, model: conn.groqModel, system, history, userText });
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (!conn.geminiKey && !conn.groqKey) errors.push("No hay API key de IA configurada");
  throw new Error(errors.join(" | "));
}

// Lee un comprobante de pago (imagen o PDF)
export async function analyzeReceipt({ cfg, mime, base64, expected }) {
  const conn = cfg.connections;
  if (!conn.geminiKey) return null;
  const schema = {
    type: "OBJECT",
    properties: {
      is_receipt: { type: "BOOLEAN" },
      amount: { type: "NUMBER" },
      bank: { type: "STRING" },
      date: { type: "STRING" },
      reference: { type: "STRING" },
      beneficiary: { type: "STRING" },
      notes: { type: "STRING" },
    },
    required: ["is_receipt"],
  };
  const contents = [{
    role: "user",
    parts: [
      { inlineData: { mimeType: mime, data: base64 } },
      { text: `¿Esta imagen es un comprobante de pago, transferencia o depósito bancario? Extraé monto, banco, fecha, número de referencia y beneficiario si aparecen. El monto esperado es ${expected}. Si no es comprobante, is_receipt=false y describí brevemente qué es en notes.` },
    ],
  }];
  for (const model of [conn.geminiModel, conn.geminiFallbackModel].filter(Boolean)) {
    try {
      return await geminiJSON({ key: conn.geminiKey, model, contents, schema, timeoutMs: 6000, temperature: 0 });
    } catch (e) {
      if (e.status && ![429, 500, 503].includes(e.status)) return null;
    }
  }
  return null;
}
