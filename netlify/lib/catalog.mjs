import { getJSON, setJSON } from "./store.mjs";
import { norm, money } from "./util.mjs";

// Estructura del catálogo:
// { attributes: ["Corte","Talla","Color"], updatedAt, variants: [
//   { sku, product, category, description, image, price, attrs:{Corte:"Regular",...},
//     stockMode: "ilimitado"|"cantidad"|"agotado", stock: number|null, active: true } ] }

export async function loadCatalog() {
  return getJSON("catalog", "main", { attributes: [], variants: [], updatedAt: null });
}

export async function saveCatalog(cat) {
  const clean = sanitizeCatalog(cat);
  clean.updatedAt = new Date().toISOString();
  await setJSON("catalog", "main", clean);
  return clean;
}

export function sanitizeCatalog(cat) {
  const variants = (cat?.variants || [])
    .filter((v) => v && v.product && String(v.product).trim())
    .map((v, i) => {
      const attrs = {};
      for (const [k, val] of Object.entries(v.attrs || {})) {
        if (val !== undefined && val !== null && String(val).trim() !== "") attrs[String(k).trim()] = String(val).trim();
      }
      let stockMode = ["ilimitado", "cantidad", "agotado"].includes(v.stockMode) ? v.stockMode : "ilimitado";
      const stock = stockMode === "cantidad" ? Math.max(0, parseInt(v.stock, 10) || 0) : null;
      return {
        sku: String(v.sku || `SKU-${i + 1}`).trim(),
        product: String(v.product).trim(),
        category: String(v.category || "General").trim() || "General",
        description: String(v.description || "").trim(),
        image: String(v.image || "").trim(),
        price: Math.round((Number(String(v.price).replace(/[^0-9.]/g, "")) || 0) * 100) / 100,
        attrs,
        stockMode,
        stock,
        active: v.active !== false,
      };
    });
  const attrSet = new Set();
  variants.forEach((v) => Object.keys(v.attrs).forEach((a) => attrSet.add(a)));
  const attributes = (cat?.attributes || []).filter((a) => attrSet.has(a));
  attrSet.forEach((a) => { if (!attributes.includes(a)) attributes.push(a); });
  return { attributes, variants };
}

export function isAvailable(v) {
  if (!v || v.active === false) return false;
  if (v.stockMode === "agotado") return false;
  if (v.stockMode === "cantidad") return (Number(v.stock) || 0) > 0;
  return true;
}

export function groupProducts(cat) {
  const map = new Map();
  for (const v of cat.variants || []) {
    const key = norm(v.product);
    if (!map.has(key)) map.set(key, { name: v.product, category: v.category, description: v.description, image: v.image, variants: [] });
    const p = map.get(key);
    p.variants.push(v);
    if (!p.description && v.description) p.description = v.description;
    if (!p.image && v.image) p.image = v.image;
  }
  return [...map.values()];
}

function attrValues(variants, attr) {
  const vals = [];
  for (const v of variants) {
    const x = v.attrs[attr];
    if (x && !vals.includes(x)) vals.push(x);
  }
  return vals;
}

function variantLabel(v, attrs) {
  return attrs.map((a) => v.attrs[a]).filter(Boolean).join("/");
}

// Texto compacto del catálogo para la IA
export function catalogForAI(cat, cur = "$") {
  const products = groupProducts(cat);
  if (!products.length) return "(El catálogo está vacío. Si preguntan por productos, decí que en un momento un asesor les comparte las opciones y marcá needs_human.)";
  const byCat = new Map();
  for (const p of products) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }
  const lines = [];
  for (const [category, list] of byCat) {
    lines.push(`[${category}]`);
    for (const p of list) {
      const attrs = (cat.attributes || []).filter((a) => p.variants.some((v) => v.attrs[a]));
      const avail = p.variants.filter(isAvailable);
      const prices = [...new Set(p.variants.map((v) => v.price))];
      let priceTxt = prices.length === 1 ? money(prices[0], cur) : `desde ${money(Math.min(...prices), cur)}`;
      let line = `• ${p.name} — ${priceTxt}`;
      if (p.description) line += ` — ${p.description}`;
      if (p.image) line += " (tiene foto)";
      if (!avail.length) line += " — AGOTADO";
      lines.push(line);
      if (attrs.length) {
        lines.push("   Opciones: " + attrs.map((a) => `${a}: ${attrValues(p.variants, a).join(", ")}`).join(" | "));
      }
      if (prices.length > 1) {
        // ¿El precio depende de un solo atributo?
        let explained = false;
        for (const a of attrs) {
          const m = new Map();
          let ok = true;
          for (const v of p.variants) {
            const k = v.attrs[a];
            if (m.has(k) && m.get(k) !== v.price) { ok = false; break; }
            m.set(k, v.price);
          }
          if (ok) {
            lines.push(`   Precio según ${a}: ` + [...m].map(([k, pr]) => `${k} ${money(pr, cur)}`).join(", "));
            explained = true;
            break;
          }
        }
        if (!explained) {
          lines.push("   Precios: " + p.variants.slice(0, 25).map((v) => `${variantLabel(v, attrs) || v.sku} ${money(v.price, cur)}`).join("; "));
        }
      }
      const unavailable = p.variants.filter((v) => !isAvailable(v));
      if (avail.length && unavailable.length) {
        if (unavailable.length <= avail.length) {
          lines.push("   Agotado: " + unavailable.slice(0, 30).map((v) => variantLabel(v, attrs) || v.sku).join(", "));
        } else {
          lines.push("   SOLO disponible: " + avail.slice(0, 30).map((v) => variantLabel(v, attrs) || v.sku).join(", "));
        }
      }
    }
  }
  return lines.join("\n");
}

function scoreProduct(name, query) {
  const a = norm(name), b = norm(query);
  if (!b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;
  const ta = new Set(a.split(" ")), tb = b.split(" ");
  const hit = tb.filter((t) => t.length > 1 && ta.has(t)).length;
  return hit ? (hit / Math.max(ta.size, tb.length)) * 70 : 0;
}

export function findProduct(cat, query) {
  const products = groupProducts(cat);
  let best = null, bestScore = 0;
  for (const p of products) {
    const s = scoreProduct(p.name, query);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  return bestScore >= 35 ? best : null;
}

const valEq = (a, b) => {
  const x = norm(a), y = norm(b);
  return x === y || (y.length > 2 && x.startsWith(y)) || x.replace(/\s/g, "") === y.replace(/\s/g, "");
};

// Resuelve el producto + opciones elegidas en una variante concreta
export function resolveVariant(cat, product, options = []) {
  const p = findProduct(cat, product);
  if (!p) return { error: "not_found", product };
  const attrs = (cat.attributes || []).filter((a) => p.variants.some((v) => v.attrs[a]));
  let cands = p.variants.slice();
  for (const o of options || []) {
    if (!o || !o.value) continue;
    let attr = attrs.find((a) => norm(a) === norm(o.name));
    if (!attr) attr = attrs.find((a) => p.variants.some((v) => valEq(v.attrs[a], o.value)));
    if (!attr) continue;
    const filtered = cands.filter((v) => valEq(v.attrs[attr], o.value));
    cands = filtered;
  }
  if (!cands.length) return { error: "combo_not_found", product: p.name, options };
  if (cands.length > 1) {
    const missing = attrs.filter((a) => new Set(cands.map((v) => v.attrs[a])).size > 1);
    return { error: "missing", product: p.name, missing, values: Object.fromEntries(missing.map((a) => [a, attrValues(cands, a)])) };
  }
  const v = cands[0];
  if (!isAvailable(v)) return { error: "unavailable", product: p.name, variant: v, label: variantLabel(v, attrs) };
  return { variant: v, label: variantLabel(v, attrs) };
}

export function productImages(cat, names = []) {
  const out = [];
  for (const n of names) {
    const p = findProduct(cat, n);
    if (p && p.image && !out.find((o) => o.link === p.image)) {
      const prices = [...new Set(p.variants.map((v) => v.price))];
      out.push({ link: p.image, caption: `*${p.name}*${prices.length ? ` — ${prices.length === 1 ? money(prices[0]) : "desde " + money(Math.min(...prices))}` : ""}` });
    }
  }
  return out.slice(0, 3);
}

export function decrementStock(cat, items) {
  let changed = false;
  for (const it of items) {
    const v = cat.variants.find((x) => x.sku === it.sku);
    if (v && v.stockMode === "cantidad") {
      v.stock = Math.max(0, (Number(v.stock) || 0) - (Number(it.qty) || 1));
      changed = true;
    }
  }
  return changed;
}
