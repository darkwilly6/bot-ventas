export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ$.\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function money(n, cur = "$") {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${cur}${v.toFixed(2)}`;
}

export function clip(s, n) {
  s = String(s ?? "").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function uid(len = 10) {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += a[Math.floor(Math.random() * a.length)];
  return out;
}

export function orderCode(prefix = "PED") {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += a[Math.floor(Math.random() * a.length)];
  return `${prefix || "PED"}-${c}`;
}

export function onlyDigits(s) {
  return String(s ?? "").replace(/\D/g, "");
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function deepMerge(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === "object") {
    const out = { ...base };
    if (over && typeof over === "object" && !Array.isArray(over)) {
      for (const k of Object.keys(over)) {
        out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
      }
    }
    return out;
  }
  return over === undefined ? base : over;
}
