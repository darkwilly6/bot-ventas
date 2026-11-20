import { getJSON, setJSON } from "./store.mjs";
import { deepMerge } from "./util.mjs";

export const DEFAULT_CONFIG = {
  business: {
    name: "Mi Tienda",
    description: "Tienda en línea con envíos a todo el país.",
    tone: "Cercano y salvadoreño: usá voseo (vos, querés, tenés, mirá), cálido, alegre y respetuoso. Emojis con moderación (1 o 2 por mensaje).",
    greeting: "¡Hola! 👋 Bienvenido/a. ¿Qué andás buscando hoy?",
    policies: "",
    hours: "El bot atiende 24/7. Un asesor humano responde de lunes a sábado de 8:00 a.m. a 6:00 p.m.",
    faq: "",
    currency: "$",
    orderPrefix: "PED",
  },
  payments: {
    fullEnabled: true,
    depositEnabled: true,
    depositAmount: 5,
    shippingCost: 3,
    freeShippingOnFull: true,
    deliveryTime: "2 a 4 días hábiles",
    accounts: [{ bank: "", type: "Ahorro", number: "", holder: "" }],
    otherInstructions: "",
  },
  customerFields: [
    { key: "nombre", label: "Nombre y apellido", required: true },
    { key: "telefono", label: "Número de teléfono", required: true },
    { key: "departamento", label: "Departamento", required: true },
    { key: "municipio", label: "Municipio", required: true },
    { key: "direccion", label: "Dirección exacta", required: true },
    { key: "referencia", label: "Punto de referencia", required: true },
    { key: "comentario", label: "Comentario adicional", required: false },
  ],
  bot: {
    enabled: true,
    pauseOnManualReplyHours: 12,
    handoffPausesBot: true,
    handoffPauseHours: 6,
    extraInstructions: "",
  },
  labels: ["VIP", "Mayorista", "Reclamo", "Cliente frecuente"],
  notify: {
    ownerPhone: "",
    email: "",
    onNewOrder: true,
    onPayment: true,
    onHuman: true,
  },
  connections: {
    waToken: "",
    phoneNumberId: "",
    verifyToken: "",
    appSecret: "",
    graphVersion: "v22.0",
    geminiKey: "",
    geminiModel: "gemini-2.5-flash",
    geminiFallbackModel: "gemini-2.5-flash-lite",
    groqKey: "",
    groqModel: "openai/gpt-oss-120b",
    resendKey: "",
  },
};

export const SECRET_FIELDS = ["waToken", "appSecret", "geminiKey", "groqKey", "resendKey"];

const ENV_MAP = {
  waToken: "WHATSAPP_TOKEN",
  phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
  verifyToken: "WHATSAPP_VERIFY_TOKEN",
  appSecret: "WHATSAPP_APP_SECRET",
  geminiKey: "GEMINI_API_KEY",
  groqKey: "GROQ_API_KEY",
  resendKey: "RESEND_API_KEY",
};

export async function loadRawConfig() {
  return getJSON("config", "main", {});
}

export async function loadConfig() {
  const raw = await loadRawConfig();
  const cfg = deepMerge(DEFAULT_CONFIG, raw || {});
  // Variables de entorno de Netlify tienen prioridad si existen
  for (const [k, env] of Object.entries(ENV_MAP)) {
    if (process.env[env]) cfg.connections[k] = process.env[env];
  }
  // Modelo de Groq retirado en agosto de 2026: se reemplaza automáticamente
  if (!cfg.connections.groqModel || cfg.connections.groqModel === "llama-3.3-70b-versatile") {
    cfg.connections.groqModel = "openai/gpt-oss-120b";
  }
  return cfg;
}

export async function saveConfig(newCfg) {
  const current = await loadRawConfig();
  const merged = deepMerge(deepMerge(DEFAULT_CONFIG, current || {}), newCfg || {});
  // Los secretos enmascarados ("••••1234") no se sobreescriben
  for (const k of SECRET_FIELDS) {
    const v = newCfg?.connections?.[k];
    if (typeof v === "string" && v.startsWith("••••")) {
      merged.connections[k] = current?.connections?.[k] || "";
    }
  }
  await setJSON("config", "main", merged);
  return merged;
}

export function maskConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  out._env = {};
  for (const k of SECRET_FIELDS) {
    const v = out.connections[k];
    if (v) out.connections[k] = "••••" + String(v).slice(-4);
  }
  for (const [k, env] of Object.entries(ENV_MAP)) out._env[k] = !!process.env[env];
  return out;
}

export function paymentExplanation(cfg) {
  const p = cfg.payments;
  const c = cfg.business.currency || "$";
  const ship = Number(p.shippingCost) || 0;
  const parts = [];
  if (p.fullEnabled) {
    parts.push(
      `Pago COMPLETO por transferencia o depósito${p.freeShippingOnFull && ship ? ` → el envío (${c}${ship.toFixed(2)}) es GRATIS` : ship ? ` + envío ${c}${ship.toFixed(2)}` : ""}.`
    );
  }
  if (p.depositEnabled) {
    parts.push(
      `ANTICIPO de ${c}${Number(p.depositAmount).toFixed(2)} por transferencia o depósito y el resto se paga CONTRA ENTREGA al recibir el paquete${ship ? ` (en esta opción se suma el envío de ${c}${ship.toFixed(2)})` : ""}. El anticipo se resta del total.`
    );
  }
  return parts.map((t, i) => `${i + 1}) ${t}`).join("\n");
}
