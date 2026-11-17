// Almacenamiento: Netlify Blobs (gratis, incluido en Netlify).
// Con BOT_MEMORY_STORE=1 usa memoria (solo para pruebas locales).
import { getStore } from "@netlify/blobs";

const mem = new Map();
const useMem = () => process.env.BOT_MEMORY_STORE === "1";

function memStore(name) {
  if (!mem.has(name)) mem.set(name, new Map());
  const m = mem.get(name);
  return {
    async get(key, opts = {}) {
      if (!m.has(key)) return null;
      const v = m.get(key);
      if (opts.type === "json") return JSON.parse(v);
      if (opts.type === "arrayBuffer") return v;
      return v;
    },
    async setJSON(key, value) { m.set(key, JSON.stringify(value)); },
    async set(key, value) { m.set(key, value); },
    async delete(key) { m.delete(key); },
    async list(opts = {}) {
      const keys = [...m.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix));
      return { blobs: keys.map((key) => ({ key })) };
    },
  };
}

export function store(name) {
  if (useMem()) return memStore(name);
  return getStore({ name, consistency: "strong" });
}

export async function getJSON(name, key, fallback = null) {
  try {
    const v = await store(name).get(key, { type: "json" });
    return v ?? fallback;
  } catch (e) {
    console.error("getJSON", name, key, e.message);
    return fallback;
  }
}

export async function setJSON(name, key, value) {
  await store(name).setJSON(key, value);
}

export async function delKey(name, key) {
  await store(name).delete(key);
}

export async function listKeys(name, prefix) {
  const r = await store(name).list(prefix ? { prefix } : {});
  return (r.blobs || []).map((b) => b.key);
}

export async function setBinary(name, key, buffer) {
  const s = store(name);
  // ArrayBuffer para Netlify Blobs
  const ab = buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
  await s.set(key, ab);
}

export async function getBinary(name, key) {
  return store(name).get(key, { type: "arrayBuffer" });
}
