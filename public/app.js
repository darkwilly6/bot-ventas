/* Panel de administración del Bot de Ventas */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = {
  token: lsGet("token"),
  cfg: null, catalog: null, convos: [], orders: [], notifs: [], status: null,
  view: "inicio", convoId: null, convo: null, chatFilter: "todas", chatSearch: "",
  orderFilter: "activos", catSearch: "", seenNotifs: new Set(), firstNotifLoad: true,
  simSession: lsGet("simSession") || Math.random().toString(36).slice(2, 10),
};
const STATUS = {
  esperando_pago: ["⏳ Esperando pago", "warn"],
  pago_por_verificar: ["💰 Pago por verificar", "danger"],
  confirmado: ["✅ Confirmado", "accent"],
  enviado: ["🚚 Enviado", "accent"],
  entregado: ["📦 Entregado", ""],
  cancelado: ["❌ Cancelado", ""],
};

function lsGet(k) { try { return localStorage.getItem("bot_" + k); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem("bot_" + k) : localStorage.setItem("bot_" + k, v); } catch {} }
const money = (n) => `${S.cfg?.business?.currency || "$"}${(Number(n) || 0).toFixed(2)}`;
const fmtDate = (t) => (t ? new Date(t).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const waFmt = (s) => esc(s).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/_([^_\n]+)_/g, "<i>$1</i>").replace(/~([^~\n]+)~/g, "<s>$1</s>");

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

async function api(path, opts = {}) {
  const r = await fetch("/api/" + path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "login") { logout(); throw new Error("Sesión expirada"); }
  if (!r.ok) throw new Error(j.error || "Error " + r.status);
  return j;
}

/* ---------------- Login ---------------- */
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    const { token } = await api("login", { method: "POST", body: { password: $("#password").value } });
    S.token = token; lsSet("token", token); start();
  } catch (err) { $("#loginError").textContent = err.message; }
});
function logout() { S.token = null; lsSet("token", null); $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); }
$("#logoutBtn").addEventListener("click", logout);

async function start() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  try {
    [S.cfg, S.status] = await Promise.all([api("config"), api("status")]);
    $("#brandName").textContent = S.cfg.business.name;
  } catch (e) { return toast(e.message); }
  route();
  poll();
  setInterval(poll, 12000);
}

/* ---------------- Router ---------------- */
window.addEventListener("hashchange", route);
function route() {
  const [view, arg] = (location.hash.slice(1) || "inicio").split("/");
  S.view = view;
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  if (view === "chats" && arg) S.convoId = decodeURIComponent(arg);
  render();
}
function render() {
  const v = { inicio: viewHome, chats: viewChats, pedidos: viewOrders, catalogo: viewCatalog, config: viewConfig, simulador: viewSim }[S.view] || viewHome;
  v();
}

/* ---------------- Polling + notificaciones ---------------- */
async function poll() {
  try {
    const [notifs, convos] = await Promise.all([api("notifications"), api("conversations")]);
    S.notifs = notifs; S.convos = convos;
    const fresh = notifs.filter((n) => !n.read && !S.seenNotifs.has(n.id));
    notifs.forEach((n) => S.seenNotifs.add(n.id));
    if (!S.firstNotifLoad && fresh.length) alertNew(fresh);
    S.firstNotifLoad = false;
    updateBadges();
    if (S.view === "chats") { renderChatList(); if (S.convoId) refreshConvo(true); }
    if (S.view === "inicio") renderHomeNotifs();
    if (!$("#drawer").classList.contains("hidden")) renderDrawer();
  } catch {}
}
function updateBadges() {
  const unreadN = S.notifs.filter((n) => !n.read).length;
  setBadge("#badgeBell", unreadN);
  setBadge("#badgeChats", S.convos.filter((c) => !c.sim && (c.needsHuman || c.unread)).length);
  setBadge("#badgeOrders", S.convos.filter((c) => !c.sim && c.autoLabel?.includes("Pago por verificar")).length);
  document.title = (unreadN ? `(${unreadN}) ` : "") + "Bot de Ventas · Panel";
}
function setBadge(sel, n) { const b = $(sel); b.textContent = n > 99 ? "99+" : n; b.classList.toggle("show", n > 0); }
function alertNew(list) {
  beep();
  if ("Notification" in window && Notification.permission === "granted") {
    list.slice(0, 3).forEach((n) => { try { new Notification(n.title, { body: (n.body || "").slice(0, 140) }); } catch {} });
  }
  toast("🔔 " + list[0].title);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
  } catch {}
}
$("#bellBtn").addEventListener("click", () => { $("#drawer").classList.toggle("hidden"); renderDrawer(); });
$("#closeDrawer").addEventListener("click", () => $("#drawer").classList.add("hidden"));
$("#readAllBtn").addEventListener("click", async () => { await api("notifications", { method: "POST", body: { ids: "all" } }); S.notifs.forEach((n) => (n.read = true)); updateBadges(); renderDrawer(); });
function notifHtml(n) {
  return `<div class="notif ${n.read ? "" : "unread"}" data-notif="${esc(n.id)}"><div class="row"><span class="t">${esc(n.title)}</span><span class="spacer"></span><span class="muted small">${fmtDate(n.at)}</span></div><div class="b">${esc(n.body || "")}</div></div>`;
}
function renderDrawer() {
  $("#notifList").innerHTML = S.notifs.length ? S.notifs.slice(0, 80).map(notifHtml).join("") : `<div class="empty">Sin notificaciones</div>`;
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-notif]");
  if (!el) return;
  const n = S.notifs.find((x) => x.id === el.dataset.notif);
  if (!n) return;
  if (!n.read) { n.read = true; api("notifications", { method: "POST", body: { ids: [n.id] } }); updateBadges(); }
  $("#drawer").classList.add("hidden");
  if (n.orderId) { location.hash = "#pedidos"; setTimeout(() => openOrder(n.orderId), 300); }
  else if (n.waId) { location.hash = "#chats/" + encodeURIComponent(n.waId); }
});

/* ---------------- Inicio ---------------- */
async function viewHome() {
  const st = S.status || {};
  const main = $("#main");
  main.innerHTML = `
    <div class="page-head"><h2>👋 Hola, ${esc(S.cfg.business.name)}</h2><span class="spacer"></span>
      <button class="btn small" id="enableNotif">🔔 Activar alertas del navegador</button></div>
    <div class="grid cols-4" id="stats"><div class="card stat"><div class="num">…</div><div class="lbl">Cargando</div></div></div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card">
        <h3>✅ Puesta en marcha</h3>
        <ul class="checklist">
          <li class="${st.ai ? "ok" : "bad"}">${st.ai ? "✔" : "✘"} IA (Gemini) configurada</li>
          <li class="${st.whatsapp ? "ok" : "bad"}">${st.whatsapp ? "✔" : "✘"} WhatsApp conectado (token + Phone Number ID)</li>
          <li class="${st.verifyToken ? "ok" : "bad"}">${st.verifyToken ? "✔" : "✘"} Token de verificación del webhook</li>
          <li class="${S.catalog?.variants?.length || "pending"}" id="chkCatalog">… Catálogo cargado</li>
          <li class="${st.ownerPhone ? "ok" : "bad"}">${st.ownerPhone ? "✔" : "✘"} Tu WhatsApp personal para avisos</li>
          <li class="${st.email ? "ok" : "muted"}">${st.email ? "✔" : "○"} Avisos por correo (opcional)</li>
        </ul>
        <label>URL del webhook (pegala en Meta)</label>
        <div class="copy"><input readonly value="${esc(st.webhookUrl || "")}" id="whUrl"><button class="btn small" data-copy="#whUrl">Copiar</button></div>
        <p class="hint">Revisá la guía <b>LEEME.md</b> incluida en el zip para conectar paso a paso.</p>
      </div>
      <div class="card"><div class="row"><h3>🔔 Últimas notificaciones</h3><span class="spacer"></span><button class="btn small ghost" onclick="document.getElementById('bellBtn').click()">Ver todas</button></div><div id="homeNotifs"></div></div>
    </div>`;
  $("#enableNotif").onclick = async () => {
    if (!("Notification" in window)) return toast("Tu navegador no soporta notificaciones");
    const p = await Notification.requestPermission();
    toast(p === "granted" ? "Alertas activadas ✅" : "No se activaron las alertas");
    beep();
  };
  renderHomeNotifs();
  const [orders, catalog] = await Promise.all([api("orders"), api("catalog")]);
  S.orders = orders; S.catalog = catalog;
  const real = orders.filter((o) => !o.sim);
  const today = new Date().toDateString();
  const sales = real.filter((o) => ["confirmado", "enviado", "entregado"].includes(o.status));
  const month = new Date().getMonth();
  $("#stats").innerHTML = [
    [real.filter((o) => new Date(o.createdAt).toDateString() === today).length, "Pedidos hoy"],
    [real.filter((o) => o.status === "pago_por_verificar").length, "💰 Pagos por verificar"],
    [S.convos.filter((c) => !c.sim && c.needsHuman).length, "🆘 Necesitan ayuda"],
    [money(sales.filter((o) => new Date(o.createdAt).getMonth() === month).reduce((s, o) => s + o.total, 0)), "Ventas confirmadas del mes"],
  ].map(([n, l]) => `<div class="card stat"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join("");
  const chk = $("#chkCatalog");
  if (chk) { const ok = catalog.variants?.length; chk.className = ok ? "ok" : "bad"; chk.textContent = `${ok ? "✔" : "✘"} Catálogo cargado ${ok ? `(${catalog.variants.length} variantes)` : ""}`; }
}
function renderHomeNotifs() {
  const el = $("#homeNotifs");
  if (el) el.innerHTML = S.notifs.length ? S.notifs.slice(0, 6).map(notifHtml).join("") : `<p class="muted">Todavía no hay notificaciones.</p>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const inp = $(b.dataset.copy);
  navigator.clipboard?.writeText(inp.value).then(() => toast("Copiado ✅"), () => { inp.select(); document.execCommand("copy"); toast("Copiado ✅"); });
});

/* ---------------- Chats ---------------- */
function viewChats() {
  $("#main").innerHTML = `
    <div class="chats ${S.convoId ? "open" : ""}" id="chats">
      <div class="chat-list">
        <div class="filters">
          <input id="chatSearch" placeholder="🔍 Buscar nombre, número o etiqueta" value="${esc(S.chatSearch)}">
          <div class="row" id="chatFilters"></div>
        </div>
        <div class="chat-items" id="chatItems"></div>
      </div>
      <div class="chat-view" id="chatView"><div class="empty">Elegí una conversación</div></div>
    </div>`;
  $("#chatSearch").oninput = (e) => { S.chatSearch = e.target.value; renderChatList(); };
  renderChatList();
  if (S.convoId) refreshConvo();
}
function chatFilterDefs() {
  const base = [
    ["todas", "Todas"], ["ayuda", "🆘 Ayuda"], ["verificar", "💰 Por verificar"], ["esperando", "⏳ Esperando pago"],
    ["interesados", "🛒 Interesados"], ["confirmados", "✅ Confirmados"], ["pruebas", "🧪 Pruebas"],
  ];
  (S.cfg.labels || []).forEach((l) => base.push(["lbl:" + l, "🏷️ " + l]));
  return base;
}
function matchFilter(c, f) {
  if (f === "pruebas") return c.sim;
  if (c.sim) return false;
  switch (f) {
    case "todas": return true;
    case "ayuda": return c.needsHuman;
    case "verificar": return c.autoLabel?.includes("verificar");
    case "esperando": return c.autoLabel?.includes("Esperando");
    case "interesados": return /Interesado|Cerrando/.test(c.autoLabel || "");
    case "confirmados": return /confirmado|Enviado|Entregado/i.test(c.autoLabel || "");
  }
  if (f.startsWith("lbl:")) return (c.labels || []).includes(f.slice(4));
  return true;
}
function renderChatList() {
  const fl = $("#chatFilters");
  if (!fl) return;
  fl.innerHTML = chatFilterDefs().map(([k, l]) => `<span class="chip click ${S.chatFilter === k ? "on" : ""}" data-cf="${esc(k)}">${esc(l)}</span>`).join("");
  $$("[data-cf]", fl).forEach((c) => (c.onclick = () => { S.chatFilter = c.dataset.cf; renderChatList(); }));
  const q = S.chatSearch.toLowerCase();
  const list = S.convos.filter((c) => matchFilter(c, S.chatFilter)).filter((c) => !q || `${c.name} ${c.waId} ${(c.labels || []).join(" ")} ${c.autoLabel} ${c.orderCode || ""}`.toLowerCase().includes(q));
  $("#chatItems").innerHTML = list.length ? list.map((c) => `
    <div class="chat-item ${c.waId === S.convoId ? "active" : ""}" data-chat="${esc(c.waId)}">
      <div class="top"><span class="name">${esc(c.name || "+" + c.waId)}</span>${c.unread ? `<i class="badge show">${c.unread}</i>` : ""}<span class="muted small">${fmtDate(c.lastAt)}</span></div>
      <div class="last">${esc(c.lastText)}</div>
      <div class="row" style="gap:4px">${labelChip(c.autoLabel)}${c.botPaused ? `<span class="chip">⏸️ Bot pausado</span>` : ""}${(c.labels || []).map((l) => `<span class="chip">🏷️ ${esc(l)}</span>`).join("")}</div>
    </div>`).join("") : `<div class="empty">No hay conversaciones${S.chatFilter !== "todas" ? " con este filtro" : ""}.</div>`;
  $$("[data-chat]").forEach((el) => (el.onclick = () => { location.hash = "#chats/" + encodeURIComponent(el.dataset.chat); }));
}
function labelChip(l) {
  if (!l) return "";
  const cls = /ayuda|verificar/.test(l) ? "danger" : /Esperando|Cerrando/.test(l) ? "warn" : /confirmado|Interesado|Enviado/.test(l) ? "accent" : "";
  return `<span class="chip ${cls}">${esc(l)}</span>`;
}
async function refreshConvo(silent) {
  try {
    const { convo, orders } = await api("conversations/" + encodeURIComponent(S.convoId));
    const changed = !S.convo || S.convo.waId !== convo.waId || S.convo.messages.length !== convo.messages.length || S.convo.lastAt !== convo.lastAt;
    S.convo = convo; S.convoOrders = orders;
    if (!silent || changed) renderConvo();
  } catch (e) { if (!silent) $("#chatView").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function msgHtml(m, interactive) {
  const who = m.from === "bot" ? "🤖 Bot" : m.from === "owner" ? "👤 Vos" : "";
  let extra = "";
  if (m.buttons?.length) extra = `<div class="btns">${m.buttons.map((b, i) => interactive ? `<button data-simbtn="${esc(m.btnIds?.[i] || "T:" + b)}" data-title="${esc(b)}">${esc(b)}</button>` : `<span>${esc(b)}</span>`).join("")}</div>`;
  if (m.list?.length) extra = interactive
    ? `<div class="btns"><span>📋 ${esc(m.listButton || "Ver opciones")}</span></div><div class="list-pop">${m.list.map((t, i) => `<button class="btn small" data-simbtn="${esc(m.listIds?.[i] || "L:" + i)}" data-title="${esc(t)}">${esc(t)}</button>`).join("")}</div>`
    : `<div class="btns"><span>📋 ${esc(m.listButton || "Ver opciones")}</span></div><div class="small muted">${m.list.map(esc).join(" · ")}</div>`;
  const img = m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : "";
  return `<div class="msg ${m.from === "customer" ? "" : m.from}">${who ? `<div class="who">${who}</div>` : ""}${img}${waFmt(m.text || "")}${extra}<div class="meta">${fmtDate(m.at)}${m.error ? " ⚠️ " + esc(m.error) : ""}</div></div>`;
}
function renderConvo() {
  const c = S.convo, view = $("#chatView");
  if (!c || !view) return;
  $("#chats")?.classList.add("open");
  const fields = S.cfg.customerFields;
  const st = c.state || {};
  const paused = c.botPaused || (c.botPausedUntil && c.botPausedUntil > Date.now());
  view.innerHTML = `
    <div class="chat-head">
      <button class="btn small ghost only-mobile" id="backChats">←</button>
      <div><b>${esc(c.name || "Cliente")}</b><div class="muted small">+${esc(c.waId)}</div></div>
      <span class="spacer"></span>
      ${c.needsHuman ? `<span class="chip danger" title="${esc(c.humanReason)}">🆘 ${esc(c.humanReason || "Necesita ayuda")}</span><button class="btn small primary" id="resolveBtn">✔ Resuelto (reactivar bot)</button>` : ""}
      <button class="btn small" id="toggleBot">${paused ? "▶️ Reactivar bot" : "⏸️ Pausar bot"}</button>
      <button class="btn small only-narrow" id="infoBtn">ℹ️ Cliente</button>
      ${c.sim ? `<button class="btn small danger" id="delConvo">Borrar</button>` : ""}
    </div>
    ${paused && !c.needsHuman ? `<div class="muted small" style="padding:6px 14px;background:var(--panel-2)">⏸️ El bot no responde en este chat${c.botPausedUntil && !c.botPaused ? ` hasta ${fmtDate(c.botPausedUntil)}` : ""}. Vos tenés el control.</div>` : ""}
    <div class="chat-body" id="chatBody">
      <div class="messages" id="msgs">${c.messages.map((m) => msgHtml(m)).join("")}</div>
      <div class="side-info">
        <div><h3>🏷️ Etiquetas</h3><div class="row" style="gap:5px">${labelChip(autoLabelOf(c))}${(S.cfg.labels || []).map((l) => `<span class="chip click ${(c.labels || []).includes(l) ? "on" : ""}" data-lbl="${esc(l)}">${esc(l)}</span>`).join("")}</div></div>
        <div><h3>🛒 Carrito</h3>${st.cart?.length ? st.cart.map((it) => `<div class="small">• ${esc(it.product)} ${it.label ? `(${esc(it.label)})` : ""} x${it.qty} — ${money(it.price * it.qty)}</div>`).join("") : `<span class="muted small">Vacío</span>`}</div>
        <div><h3>📍 Datos del cliente</h3><dl>${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(st.customer?.[f.key] || "—")}</dd>`).join("")}</dl>
          <button class="btn small" id="editCustomer" style="margin-top:8px">Editar datos</button></div>
        <div><h3>📦 Pedidos</h3>${(S.convoOrders || []).length ? S.convoOrders.map((o) => `<div class="row small" style="margin-bottom:6px"><a href="#" data-open-order="${esc(o.id)}">${esc(o.code)}</a> ${statusChip(o.status)} <span>${money(o.total)}</span></div>`).join("") : `<span class="muted small">Sin pedidos</span>`}</div>
      </div>
    </div>
    <div class="composer">
      <textarea id="replyText" placeholder="Escribí una respuesta manual… (el bot se pausa en este chat)"></textarea>
      <button class="btn primary" id="sendReply">Enviar</button>
    </div>`;
  const msgs = $("#msgs"); msgs.scrollTop = msgs.scrollHeight;
  $("#backChats").onclick = () => { S.convoId = null; S.convo = null; location.hash = "#chats"; $("#chats").classList.remove("open"); };
  $("#infoBtn").onclick = () => $("#chatBody").classList.toggle("info");
  $("#toggleBot").onclick = async () => { const r = await api(`conversations/${encodeURIComponent(c.waId)}/bot`, { method: "POST", body: { paused: !paused } }); S.convo = r.convo; renderConvo(); poll(); };
  const rb = $("#resolveBtn"); if (rb) rb.onclick = async () => { const r = await api(`conversations/${encodeURIComponent(c.waId)}/resolve`, { method: "POST" }); S.convo = r.convo; renderConvo(); poll(); };
  const db = $("#delConvo"); if (db) db.onclick = async () => { if (!confirm("¿Borrar esta conversación de prueba?")) return; await api(`conversations/${encodeURIComponent(c.waId)}`, { method: "DELETE" }); S.convoId = null; location.hash = "#chats"; poll(); };
  $$("[data-lbl]").forEach((el) => (el.onclick = async () => {
    const l = el.dataset.lbl; const set = new Set(c.labels || []); set.has(l) ? set.delete(l) : set.add(l);
    const r = await api(`conversations/${encodeURIComponent(c.waId)}/labels`, { method: "POST", body: { labels: [...set] } }); S.convo = r.convo; renderConvo(); poll();
  }));
  $$("[data-open-order]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openOrder(a.dataset.openOrder); }));
  $("#editCustomer").onclick = () => editCustomerModal(st.customer || {}, async (customer) => {
    const r = await api(`conversations/${encodeURIComponent(c.waId)}/customer`, { method: "POST", body: { customer } }); S.convo = r.convo; renderConvo();
  });
  const send = async () => {
    const text = $("#replyText").value.trim(); if (!text) return;
    $("#sendReply").disabled = true;
    try { const r = await api(`conversations/${encodeURIComponent(c.waId)}/send`, { method: "POST", body: { text } }); S.convo = r.convo; renderConvo(); poll(); }
    catch (e) { toast("⚠️ " + e.message, 6000); $("#sendReply").disabled = false; }
  };
  $("#sendReply").onclick = send;
  $("#replyText").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
}
function autoLabelOf(c) { return S.convos.find((x) => x.waId === c.waId)?.autoLabel || ""; }
function statusChip(s) { const [l, cls] = STATUS[s] || [s, ""]; return `<span class="chip ${cls}">${esc(l)}</span>`; }

function editCustomerModal(customer, onSave) {
  openModal(`<h2>📍 Datos de envío</h2>
    ${S.cfg.customerFields.map((f) => `<label>${esc(f.label)}${f.required ? " *" : ""}</label><input data-cf-key="${esc(f.key)}" value="${esc(customer[f.key] || "")}">`).join("")}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="saveCust">Guardar</button></div>`);
  $("#saveCust").onclick = async () => {
    const out = {}; $$("[data-cf-key]").forEach((i) => (out[i.dataset.cfKey] = i.value.trim()));
    await onSave(out); closeModal(); toast("Guardado ✅");
  };
}

/* ---------------- Modal ---------------- */
function openModal(html) { $("#modalBox").innerHTML = html; $("#modal").classList.remove("hidden"); $$("[data-close]", $("#modalBox")).forEach((b) => (b.onclick = closeModal)); }
function closeModal() { $("#modal").classList.add("hidden"); }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

/* ---------------- Pedidos ---------------- */
async function viewOrders() {
  $("#main").innerHTML = `<div class="page-head"><h2>📦 Pedidos</h2><span class="spacer"></span>
      <button class="btn small" id="printSel">🏷️ Imprimir etiquetas</button><button class="btn small" id="exportCsv">⬇️ Exportar CSV</button></div>
    <div class="tabs" id="orderTabs"></div><div id="orderTable"><p class="muted">Cargando…</p></div>`;
  S.orders = await api("orders");
  renderOrders();
  $("#exportCsv").onclick = exportOrdersCsv;
  $("#printSel").onclick = () => {
    const ids = $$("[data-osel]:checked").map((i) => i.dataset.osel);
    const list = S.orders.filter((o) => ids.includes(o.id));
    if (!list.length) return toast("Seleccioná uno o más pedidos con la casilla");
    printLabels(list);
  };
}
function orderFilterFn(o) {
  const f = S.orderFilter;
  if (f === "pruebas") return o.sim;
  if (o.sim) return false;
  if (f === "activos") return ["esperando_pago", "pago_por_verificar", "confirmado", "enviado"].includes(o.status);
  if (f === "todos") return true;
  return o.status === f;
}
function renderOrders() {
  const tabs = [["activos", "Activos"], ["pago_por_verificar", "💰 Por verificar"], ["esperando_pago", "⏳ Esperando pago"], ["confirmado", "✅ Confirmados"], ["enviado", "🚚 Enviados"], ["entregado", "📦 Entregados"], ["cancelado", "❌ Cancelados"], ["todos", "Todos"], ["pruebas", "🧪 Pruebas"]];
  $("#orderTabs").innerHTML = tabs.map(([k, l]) => {
    const n = S.orders.filter((o) => { const prev = S.orderFilter; S.orderFilter = k; const r = orderFilterFn(o); S.orderFilter = prev; return r; }).length;
    return `<span class="chip click ${S.orderFilter === k ? "on" : ""}" data-of="${k}">${l} (${n})</span>`;
  }).join("");
  $$("[data-of]").forEach((c) => (c.onclick = () => { S.orderFilter = c.dataset.of; renderOrders(); }));
  const list = S.orders.filter(orderFilterFn);
  $("#orderTable").innerHTML = list.length ? `<div class="table-wrap"><table>
    <thead><tr><th><input type="checkbox" id="selAll"></th><th>Pedido</th><th>Cliente</th><th>Productos</th><th>Total</th><th>Pago</th><th>Estado</th><th>Fecha</th></tr></thead>
    <tbody>${list.map((o) => `<tr class="clickable" data-order="${esc(o.id)}">
      <td><input type="checkbox" data-osel="${esc(o.id)}"></td>
      <td><b>${esc(o.code)}</b></td>
      <td>${esc(o.customer?.nombre || o.name || "")}<div class="muted small">${esc([o.customer?.municipio, o.customer?.departamento].filter(Boolean).join(", "))}</div></td>
      <td class="small">${o.items.map((i) => `${esc(i.product)}${i.label ? ` (${esc(i.label)})` : ""} x${i.qty}`).join("<br>")}</td>
      <td><b>${money(o.total)}</b></td>
      <td class="small">${o.method === "anticipo" ? `Anticipo ${money(o.payNow)}<br>Contra entrega ${money(o.payOnDelivery)}` : "Completo"}</td>
      <td>${statusChip(o.status)}</td>
      <td class="small muted">${fmtDate(o.createdAt)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty">No hay pedidos en esta vista.</div>`;
  const sa = $("#selAll"); if (sa) sa.onchange = () => $$("[data-osel]").forEach((c) => (c.checked = sa.checked));
  $$("[data-osel]").forEach((c) => (c.onclick = (e) => e.stopPropagation()));
  $$("[data-order]").forEach((tr) => (tr.onclick = () => openOrder(tr.dataset.order)));
}
async function openOrder(id) {
  if (!S.orders.find((o) => o.id === id)) S.orders = await api("orders");
  const o = S.orders.find((x) => x.id === id);
  if (!o) return toast("Pedido no encontrado");
  const receipts = (o.receipts || []).map((r) => `
    <div class="card" style="padding:10px">
      ${r.key ? (r.mime === "application/pdf" ? `<a target="_blank" href="/api/media/${r.key}?t=${encodeURIComponent(S.token)}&mime=application/pdf">📄 Ver PDF</a>` : `<a target="_blank" href="/api/media/${r.key}?t=${encodeURIComponent(S.token)}&mime=${encodeURIComponent(r.mime)}"><img class="receipt" src="/api/media/${r.key}?t=${encodeURIComponent(S.token)}&mime=${encodeURIComponent(r.mime)}"></a>`) : "<span class='muted'>No se pudo descargar la imagen</span>"}
      ${r.analysis ? `<div class="small" style="margin-top:6px">🤖 ${r.analysis.is_receipt ? "Parece comprobante" : "⚠️ No parece comprobante"}${r.analysis.amount != null ? ` · Monto: <b>${money(r.analysis.amount)}</b> ${Math.abs(r.analysis.amount - o.payNow) < 0.01 ? "✅ coincide" : `⚠️ esperado ${money(o.payNow)}`}` : ""}${r.analysis.bank ? ` · ${esc(r.analysis.bank)}` : ""}${r.analysis.reference ? ` · Ref ${esc(r.analysis.reference)}` : ""}</div>` : ""}
      <div class="muted small">${fmtDate(r.at)}</div>
    </div>`).join("");
  openModal(`
    <div class="row"><h2>Pedido ${esc(o.code)}</h2>${statusChip(o.status)}${o.sim ? `<span class="chip">🧪 Prueba</span>` : ""}<span class="spacer"></span><button class="btn small ghost" data-close>✕</button></div>
    <div class="grid cols-2" style="margin-top:10px">
      <div>
        <h3>🛍️ Productos</h3>
        ${o.items.map((i) => `<div>• ${esc(i.product)}${i.label ? ` (${esc(i.label)})` : ""} x${i.qty} — ${money(i.price * i.qty)}</div>`).join("")}
        <div style="margin-top:8px">Subtotal: ${money(o.subtotal)}<br>Envío: ${o.shipping ? money(o.shipping) : "GRATIS"}<br><b>Total: ${money(o.total)}</b></div>
        <div style="margin-top:8px" class="card"><b>${o.method === "anticipo" ? "💵 Anticipo" : "💳 Pago completo"}</b><br>Pagar ahora: <b>${money(o.payNow)}</b>${o.payOnDelivery ? `<br>Contra entrega: <b>${money(o.payOnDelivery)}</b>` : ""}</div>
        <h3 style="margin-top:14px">📍 Envío</h3>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0">${S.cfg.customerFields.map((f) => `<dt class="muted">${esc(f.label)}</dt><dd style="margin:0">${esc(o.customer?.[f.key] || "—")}</dd>`).join("")}</dl>
        <p class="small muted">WhatsApp: +${esc(o.waId)} · <a href="#chats/${encodeURIComponent(o.waId)}" data-close>Abrir chat</a></p>
      </div>
      <div>
        <h3>🧾 Comprobantes</h3>
        ${receipts || `<p class="muted">Aún no envía comprobante.</p>`}
        <label>Notas internas</label><textarea id="orderNotes">${esc(o.notes || "")}</textarea>
        <button class="btn small" id="saveNotes" style="margin-top:6px">Guardar nota</button>
      </div>
    </div>
    <div class="row" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
      ${o.status !== "confirmado" && ["esperando_pago", "pago_por_verificar"].includes(o.status) ? `<button class="btn primary" data-oa="confirm">✅ Confirmar pago</button>` : ""}
      ${o.status === "pago_por_verificar" ? `<button class="btn danger" data-oa="reject">❌ Rechazar comprobante</button>` : ""}
      ${["confirmado"].includes(o.status) ? `<button class="btn primary" data-oa="ship">🚚 Marcar enviado</button>` : ""}
      ${["enviado"].includes(o.status) ? `<button class="btn primary" data-oa="deliver">📦 Marcar entregado</button>` : ""}
      <button class="btn" id="printOne">🏷️ Etiqueta de envío</button>
      <span class="spacer"></span>
      ${!["cancelado", "entregado"].includes(o.status) ? `<button class="btn danger small" data-oa="cancel">Cancelar pedido</button>` : ""}
    </div>
    <p class="hint">Al cambiar el estado, el bot le avisa automáticamente al cliente por WhatsApp.</p>`);
  $("#printOne").onclick = () => printLabels([o]);
  $("#saveNotes").onclick = async () => { await api("orders/" + o.id, { method: "PUT", body: { notes: $("#orderNotes").value } }); o.notes = $("#orderNotes").value; toast("Nota guardada ✅"); };
  $$("[data-oa]").forEach((b) => (b.onclick = async () => {
    const action = b.dataset.oa;
    let note = "";
    if (action === "reject" || action === "cancel") { note = prompt(action === "reject" ? "Motivo (se le envía al cliente, opcional):" : "Motivo de cancelación (opcional):") ?? null; if (note === null) return; }
    if (action === "ship") { note = prompt("Nota para el cliente (ej. número de guía, opcional):", "") ?? ""; }
    b.disabled = true;
    try {
      const r = await api(`orders/${o.id}/action`, { method: "POST", body: { action, note } });
      Object.assign(o, r.order);
      toast(r.sendErrors?.length ? "⚠️ Guardado, pero no se pudo avisar al cliente: " + r.sendErrors[0] : "Listo ✅ Cliente notificado", 5000);
      closeModal();
      if (S.view === "pedidos") renderOrders(); else if (S.view === "chats") refreshConvo();
      poll();
    } catch (e) { toast("⚠️ " + e.message, 5000); b.disabled = false; }
  }));
}
function printLabels(list) {
  const b = S.cfg.business;
  const f = (o, k) => esc(o.customer?.[k] || "");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
    @page { size: 100mm 150mm; margin: 0; }
    body { margin: 0; font-family: Arial, sans-serif; color: #000; background: #fff; }
    .lbl { width: 100mm; height: 150mm; padding: 7mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; gap: 3mm; border: 1px dashed #bbb; }
    .h { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 2mm; }
    .h b { font-size: 16pt; } .code { font-size: 14pt; font-weight: bold; border: 2px solid #000; padding: 1mm 3mm; }
    .to { font-size: 11pt; line-height: 1.35; } .to .n { font-size: 15pt; font-weight: bold; }
    .k { font-size: 8pt; text-transform: uppercase; color: #444; letter-spacing: .5px; }
    .items { font-size: 9.5pt; border-top: 1px solid #000; padding-top: 2mm; flex: 1; overflow: hidden; }
    .cod { border: 3px solid #000; text-align: center; padding: 3mm; font-size: 15pt; font-weight: bold; }
    .cod small { display: block; font-size: 9pt; font-weight: normal; }
    @media print { .lbl { border: none; } .noprint { display: none; } }
  </style></head><body>
  <div class="noprint" style="padding:10px;font-family:Arial"><button onclick="print()">🖨️ Imprimir</button> Tamaño 10×15 cm (podés cambiarlo en el diálogo de impresión)</div>
  ${list.map((o) => `<div class="lbl">
    <div class="h"><b>${esc(b.name)}</b><span class="code">${esc(o.code)}</span></div>
    <div class="to"><div class="k">Destinatario</div><div class="n">${f(o, "nombre")}</div>📞 ${f(o, "telefono") || "+" + esc(o.waId)}</div>
    <div class="to"><div class="k">Dirección</div>${f(o, "direccion")}<br><b>${f(o, "municipio")}${o.customer?.departamento ? ", " + f(o, "departamento") : ""}</b>${o.customer?.referencia ? `<br>Ref.: ${f(o, "referencia")}` : ""}${o.customer?.comentario ? `<br>Nota: ${f(o, "comentario")}` : ""}</div>
    <div class="items"><div class="k">Contenido</div>${o.items.map((i) => `• ${esc(i.product)}${i.label ? ` (${esc(i.label)})` : ""} x${i.qty}`).join("<br>")}</div>
    <div class="cod">${o.payOnDelivery > 0 ? `COBRAR: ${money(o.payOnDelivery)}<small>Contra entrega</small>` : `PAGADO ✓<small>No cobrar</small>`}</div>
  </div>`).join("")}</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return toast("Permití las ventanas emergentes para imprimir");
  w.document.write(html); w.document.close();
}
function exportOrdersCsv() {
  const fields = S.cfg.customerFields;
  const rows = [["Pedido", "Fecha", "Estado", "WhatsApp", "Productos", "Subtotal", "Envío", "Total", "Método", "Pagar ahora", "Contra entrega", ...fields.map((f) => f.label), "Notas"]];
  S.orders.filter((o) => !o.sim).forEach((o) => rows.push([o.code, new Date(o.createdAt).toLocaleString(), o.status, o.waId, o.items.map((i) => `${i.product}${i.label ? ` (${i.label})` : ""} x${i.qty}`).join("; "), o.subtotal, o.shipping, o.total, o.method, o.payNow, o.payOnDelivery, ...fields.map((f) => o.customer?.[f.key] || ""), o.notes || ""]));
  const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ---------------- Catálogo ---------------- */
const RESERVED = {
  sku: ["sku", "codigo", "cod", "id", "referencia sku"],
  product: ["producto", "nombre", "nombre del producto", "product", "articulo", "modelo"],
  category: ["categoria", "category", "linea", "coleccion"],
  description: ["descripcion", "description", "detalle", "detalles"],
  price: ["precio", "price", "valor", "precio venta", "precio de venta"],
  stock: ["stock", "inventario", "existencias", "disponible", "disponibilidad", "cantidad"],
  image: ["imagen", "foto", "image", "url imagen", "url de imagen", "link imagen", "foto url"],
  active: ["activo", "visible", "publicado"],
};
const normH = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
function parseStock(v) {
  const s = normH(v);
  if (s === "" || ["ilimitado", "si", "sí", "disponible", "hay", "∞", "infinito", "bajo pedido"].includes(s)) return { stockMode: "ilimitado", stock: null };
  if (["agotado", "no", "no disponible", "sin stock"].includes(s)) return { stockMode: "agotado", stock: null };
  const n = parseInt(s.replace(/[^0-9-]/g, ""), 10);
  if (!isNaN(n)) return { stockMode: "cantidad", stock: Math.max(0, n) };
  return { stockMode: "ilimitado", stock: null };
}
function parseCatalogRows(rows) {
  if (!rows.length) throw new Error("La hoja está vacía");
  const headers = Object.keys(rows[0]);
  const map = {}; const attrs = [];
  for (const h of headers) {
    const n = normH(h);
    if (!n || n.startsWith("__empty")) continue;
    const key = Object.keys(RESERVED).find((k) => RESERVED[k].includes(n));
    if (key && !map[key]) map[key] = h; else attrs.push(h.trim());
  }
  if (!map.product) throw new Error('No encontré la columna "Producto" en el Excel');
  if (!map.price) throw new Error('No encontré la columna "Precio" en el Excel');
  const variants = [];
  rows.forEach((r, idx) => {
    const product = String(r[map.product] ?? "").trim();
    if (!product) return;
    const lists = attrs.map((a) => String(r[a] ?? "").split(/[,;|]/).map((x) => x.trim()).filter(Boolean));
    let combos = [{}];
    attrs.forEach((a, i) => { if (!lists[i].length) return; combos = combos.flatMap((c) => lists[i].map((v) => ({ ...c, [a]: v }))); });
    const baseSku = String(r[map.sku] ?? "").trim() || `P${idx + 1}`;
    const st = parseStock(map.stock ? r[map.stock] : "");
    const active = map.active ? !["no", "0", "false", "oculto"].includes(normH(r[map.active])) : true;
    combos.forEach((c) => variants.push({
      sku: combos.length > 1 ? `${baseSku}-${Object.values(c).map((v) => v.replace(/\s+/g, "").slice(0, 6).toUpperCase()).join("-")}` : baseSku,
      product, category: String(r[map.category] ?? "").trim() || "General",
      description: String(r[map.description] ?? "").trim(), image: String(r[map.image] ?? "").trim(),
      price: Number(String(r[map.price]).replace(/[^0-9.]/g, "")) || 0, attrs: c, ...st, active,
    }));
  });
  // Si una combinación se repite, la fila de más abajo manda (útil para marcar una talla agotada)
  const byKey = new Map();
  variants.forEach((v) => {
    const key = normH(v.product) + "|" + Object.keys(v.attrs).sort().map((k) => `${k}=${normH(v.attrs[k])}`).join("|");
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...v, sku: prev.sku, image: v.image || prev.image, description: v.description || prev.description } : v);
  });
  variants.length = 0;
  variants.push(...byKey.values());
  const used = attrs.filter((a) => variants.some((v) => v.attrs[a]));
  const seen = new Set();
  variants.forEach((v) => { let s = v.sku, i = 2; while (seen.has(s)) s = `${v.sku}-${i++}`; v.sku = s; seen.add(s); });
  return { attributes: used, variants };
}
function downloadTemplate() {
  if (!window.XLSX) return toast("Cargando librería de Excel, intentá de nuevo");
  const data = [
    ["SKU", "Producto", "Categoría", "Descripción", "Precio", "Stock", "Imagen", "Corte", "Talla", "Color"],
    ["AJE-BL", "Camisa Pieza de Ajedrez", "Camisas", "Camisa 100% algodón con estampado de pieza de ajedrez", 25, "ilimitado", "https://ejemplo.com/ajedrez-blanca.jpg", "Regular, Oversize, Boxy fit", "XS, S, M, L, XL", "Blanco"],
    ["", "Camisa Pieza de Ajedrez", "Camisas", "", 25, "agotado", "", "Oversize", "XL", "Blanco"],
    ["BOL-LUNA", "Bolso Luna", "Bolsos", "Bolso de mano de cuero sintético", 30, 5, "", "", "", "Negro, Café"],
  ];
  const help = [
    ["CÓMO LLENAR TU CATÁLOGO"],
    ["• Obligatorias: Producto y Precio. Opcionales: SKU, Categoría, Descripción, Stock, Imagen."],
    ["• Cualquier otra columna (Corte, Talla, Color, Estilo, Sabor, Material…) se vuelve una OPCIÓN del producto. Podés crear las que tu negocio necesite."],
    ["• Si escribís varios valores separados por coma (ej. 'XS, S, M, L, XL'), el sistema crea una variante por cada combinación."],
    ["• Stock: vacío o 'ilimitado' = siempre disponible · 'agotado' = no disponible · un número (ej. 5) = cantidad exacta que se descuenta al confirmar pagos."],
    ["• Si una combinación específica está agotada, agregala en una fila aparte con Stock = agotado (como la fila 3 del ejemplo: Oversize XL Blanco). La fila de más abajo reemplaza a la de arriba."],
    ["• Imagen: link público (https://…) de la foto, el bot la envía cuando el cliente pide ver el producto."],
    ["• Un mismo producto puede tener precios distintos por variante: poné cada variante en su propia fila con su precio."],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [10, 26, 12, 40, 8, 10, 30, 26, 18, 14].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, "Catálogo");
  const ws2 = XLSX.utils.aoa_to_sheet(help); ws2["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Instrucciones");
  XLSX.writeFile(wb, "plantilla-catalogo.xlsx");
}
function exportCatalogXlsx() {
  const cat = S.catalog; if (!cat?.variants?.length) return toast("El catálogo está vacío");
  const head = ["SKU", "Producto", "Categoría", "Descripción", "Precio", "Stock", "Imagen", ...cat.attributes];
  const rows = cat.variants.map((v) => [v.sku, v.product, v.category, v.description, v.price, v.stockMode === "cantidad" ? v.stock : v.stockMode, v.image, ...cat.attributes.map((a) => v.attrs[a] || "")]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), "Catálogo");
  XLSX.writeFile(wb, "catalogo-actual.xlsx");
}
async function viewCatalog() {
  $("#main").innerHTML = `<div class="page-head"><h2>🗂️ Catálogo</h2><span class="spacer"></span>
      <button class="btn small" id="tplBtn">⬇️ Descargar plantilla Excel</button><button class="btn small" id="expBtn">⬇️ Exportar catálogo</button></div>
    <div class="dropzone" id="drop"><b>📤 Subí tu Excel (.xlsx, .xls o .csv)</b><div class="muted">Arrastralo aquí o hacé clic. Reemplaza el catálogo actual (antes de guardar vas a ver una vista previa).</div><input type="file" id="fileIn" accept=".xlsx,.xls,.csv" hidden></div>
    <div id="catPreview"></div>
    <div class="row" style="margin:16px 0 10px"><h3 style="margin:0">Productos actuales</h3><span class="muted small" id="catInfo"></span><span class="spacer"></span><input id="catSearch" placeholder="🔍 Buscar" style="max-width:240px" value="${esc(S.catSearch)}"><button class="btn primary small hidden" id="saveCat">💾 Guardar cambios</button></div>
    <div id="catTable"><p class="muted">Cargando…</p></div>`;
  $("#tplBtn").onclick = downloadTemplate;
  $("#expBtn").onclick = exportCatalogXlsx;
  const drop = $("#drop"), fileIn = $("#fileIn");
  drop.onclick = () => fileIn.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) readExcel(e.dataTransfer.files[0]); };
  fileIn.onchange = () => fileIn.files[0] && readExcel(fileIn.files[0]);
  $("#catSearch").oninput = (e) => { S.catSearch = e.target.value; renderCatTable(); };
  $("#saveCat").onclick = async () => { S.catalog = await api("catalog", { method: "PUT", body: S.catalog }); $("#saveCat").classList.add("hidden"); toast("Catálogo guardado ✅"); renderCatTable(); };
  S.catalog = await api("catalog");
  renderCatTable();
}
function readExcel(file) {
  if (!window.XLSX) return toast("Cargando librería de Excel, intentá de nuevo en un segundo");
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const parsed = parseCatalogRows(rows);
      const products = new Set(parsed.variants.map((v) => v.product.toLowerCase())).size;
      $("#catPreview").innerHTML = `<div class="card" style="margin-top:12px">
        <h3>👀 Vista previa de "${esc(file.name)}"</h3>
        <p><b>${products}</b> productos · <b>${parsed.variants.length}</b> variantes · Opciones detectadas: <b>${parsed.attributes.map(esc).join(", ") || "ninguna"}</b></p>
        <div class="table-wrap" style="max-height:260px">${catTableHtml(parsed.variants.slice(0, 60), parsed.attributes, false)}</div>
        ${parsed.variants.length > 60 ? `<p class="muted small">…y ${parsed.variants.length - 60} variantes más</p>` : ""}
        <div class="row" style="margin-top:10px"><button class="btn primary" id="confirmImport">✅ Guardar este catálogo</button><button class="btn" id="cancelImport">Cancelar</button></div></div>`;
      $("#cancelImport").onclick = () => ($("#catPreview").innerHTML = "");
      $("#confirmImport").onclick = async () => {
        S.catalog = await api("catalog", { method: "PUT", body: parsed });
        $("#catPreview").innerHTML = ""; toast("Catálogo importado ✅"); renderCatTable();
      };
    } catch (e) { toast("⚠️ " + e.message, 5000); }
  };
  reader.readAsArrayBuffer(file);
}
function catTableHtml(variants, attrs, editable) {
  return `<table><thead><tr><th>Producto</th><th>Categoría</th>${attrs.map((a) => `<th>${esc(a)}</th>`).join("")}<th>Precio</th><th>Disponibilidad</th>${editable ? "<th>Visible</th>" : ""}</tr></thead><tbody>
    ${variants.map((v) => `<tr>
      <td><b>${esc(v.product)}</b><div class="muted small">${esc(v.sku)}${v.image ? " · 🖼️" : ""}</div></td><td>${esc(v.category)}</td>
      ${attrs.map((a) => `<td>${esc(v.attrs[a] || "")}</td>`).join("")}
      <td>${editable ? `<input type="number" step="0.01" style="width:80px" data-ve="price" data-sku="${esc(v.sku)}" value="${v.price}">` : money(v.price)}</td>
      <td>${editable ? `<div class="row" style="gap:4px;flex-wrap:nowrap"><select data-ve="stockMode" data-sku="${esc(v.sku)}" style="width:auto">${["ilimitado", "cantidad", "agotado"].map((m) => `<option ${v.stockMode === m ? "selected" : ""} value="${m}">${{ ilimitado: "✅ Disponible", cantidad: "🔢 Cantidad", agotado: "❌ Agotado" }[m]}</option>`).join("")}</select>${v.stockMode === "cantidad" ? `<input type="number" min="0" style="width:64px" data-ve="stock" data-sku="${esc(v.sku)}" value="${v.stock ?? 0}">` : ""}</div>` : { ilimitado: "✅ Disponible", cantidad: `🔢 ${v.stock}`, agotado: "❌ Agotado" }[v.stockMode]}</td>
      ${editable ? `<td><input type="checkbox" data-ve="active" data-sku="${esc(v.sku)}" ${v.active !== false ? "checked" : ""}></td>` : ""}
    </tr>`).join("")}</tbody></table>`;
}
function renderCatTable() {
  const cat = S.catalog || { variants: [], attributes: [] };
  const q = S.catSearch.toLowerCase();
  const list = cat.variants.filter((v) => !q || `${v.product} ${v.category} ${v.sku} ${Object.values(v.attrs).join(" ")}`.toLowerCase().includes(q));
  $("#catInfo").textContent = cat.variants.length ? `${new Set(cat.variants.map((v) => v.product)).size} productos · ${cat.variants.length} variantes${cat.updatedAt ? " · actualizado " + fmtDate(cat.updatedAt) : ""}` : "";
  $("#catTable").innerHTML = cat.variants.length ? `<div class="table-wrap">${catTableHtml(list.slice(0, 500), cat.attributes, true)}</div>${list.length > 500 ? `<p class="muted small">Mostrando 500 de ${list.length}. Usá el buscador.</p>` : ""}` : `<div class="card empty">Todavía no hay productos. Descargá la plantilla, llenala y subila arriba.</div>`;
  $$("[data-ve]").forEach((inp) => (inp.onchange = () => {
    const v = cat.variants.find((x) => x.sku === inp.dataset.sku); if (!v) return;
    const k = inp.dataset.ve;
    if (k === "active") v.active = inp.checked;
    else if (k === "price") v.price = Number(inp.value) || 0;
    else if (k === "stock") v.stock = Math.max(0, parseInt(inp.value, 10) || 0);
    else if (k === "stockMode") { v.stockMode = inp.value; if (v.stockMode === "cantidad" && v.stock == null) v.stock = 1; renderCatTable(); }
    $("#saveCat").classList.remove("hidden");
  }));
}

/* ---------------- Configuración ---------------- */
function getPath(o, p) { return p.split(".").reduce((a, k) => a?.[k], o); }
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; }
function fld(path, label, opts = {}) {
  const v = getPath(S.cfg, path);
  const env = path.startsWith("connections.") && S.cfg._env?.[path.split(".")[1]];
  if (opts.type === "checkbox") return `<label class="check"><input type="checkbox" data-path="${path}" ${v ? "checked" : ""}> ${label}</label>`;
  if (opts.type === "textarea") return `<label>${label}</label><textarea data-path="${path}" placeholder="${esc(opts.ph || "")}">${esc(v ?? "")}</textarea>${opts.hint ? `<p class="hint">${opts.hint}</p>` : ""}`;
  if (opts.type === "select") return `<label>${label}</label><select data-path="${path}">${opts.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  return `<label>${label}${env ? ' <span class="chip accent">definido en Netlify</span>' : ""}</label><input data-path="${path}" type="${opts.type || "text"}" ${opts.step ? `step="${opts.step}"` : ""} value="${esc(v ?? "")}" placeholder="${esc(opts.ph || "")}" ${env ? "disabled" : ""}>${opts.hint ? `<p class="hint">${opts.hint}</p>` : ""}`;
}
function viewConfig() {
  const c = S.cfg;
  $("#main").innerHTML = `<div class="page-head"><h2>⚙️ Ajustes</h2></div>
  <div class="grid cols-2">
    <div class="card section"><h3>🏪 Negocio</h3>
      ${fld("business.name", "Nombre del negocio")}
      ${fld("business.description", "¿Qué vendés? (1-2 líneas)", { type: "textarea", ph: "Ej.: Marca de streetwear salvadoreña. Camisas con diseños originales en cortes Regular, Oversize y Boxy fit." })}
      ${fld("business.greeting", "Saludo de bienvenida sugerido")}
      ${fld("business.tone", "Tono del bot", { type: "textarea" })}
      <div class="grid cols-2" style="gap:10px">${fld("business.currency", "Moneda (símbolo)")}${fld("business.orderPrefix", "Prefijo de pedidos", { ph: "NX" })}</div>
    </div>
    <div class="card section"><h3>📚 Información que el bot debe saber</h3>
      ${fld("business.hours", "Horario de atención humana")}
      ${fld("payments.deliveryTime", "Tiempo de entrega", { ph: "2 a 4 días hábiles" })}
      ${fld("business.policies", "Políticas (cambios, devoluciones, garantía)", { type: "textarea" })}
      ${fld("business.faq", "Preguntas frecuentes / guía de tallas / datos útiles", { type: "textarea", ph: "Ej.: Guía de tallas: S = 50 cm de pecho… Hacemos envíos a todo El Salvador…" })}
      ${fld("bot.extraInstructions", "Instrucciones extra para el bot", { type: "textarea", ph: "Ej.: Si preguntan por personalizados, decí que sí hacemos con mínimo 6 piezas." })}
    </div>
    <div class="card section"><h3>💳 Pagos y envío</h3>
      ${fld("payments.fullEnabled", "Permitir pago completo por transferencia/depósito", { type: "checkbox" })}
      ${fld("payments.freeShippingOnFull", "Envío GRATIS si paga el 100%", { type: "checkbox" })}
      ${fld("payments.depositEnabled", "Permitir anticipo + resto contra entrega", { type: "checkbox" })}
      <div class="grid cols-2" style="gap:10px">${fld("payments.depositAmount", "Monto del anticipo", { type: "number", step: "0.01" })}${fld("payments.shippingCost", "Costo de envío", { type: "number", step: "0.01" })}</div>
      <p class="hint">Ejemplo con producto de $25: pago completo = $25 (envío gratis) · anticipo = $5 ahora + $23 contra entrega (total $28).</p>
      <label>Cuentas para depósito / transferencia</label>
      <div class="list-editor" id="accounts"></div>
      <button class="btn small" id="addAccount">+ Agregar cuenta</button>
      ${fld("payments.otherInstructions", "Otras instrucciones de pago (opcional)", { type: "textarea", ph: "Ej.: También aceptamos Tigo Money al 7000-0000." })}
    </div>
    <div class="card section"><h3>📍 Datos que el bot pide para el envío</h3>
      <div class="list-editor" id="custFields"></div>
      <button class="btn small" id="addField">+ Agregar dato</button>
      <h3 style="margin-top:18px">🏷️ Etiquetas manuales</h3>
      <input id="labelsIn" value="${esc((c.labels || []).join(", "))}" placeholder="VIP, Mayorista, Reclamo">
      <p class="hint">Separadas por coma. Las etiquetas automáticas (Nuevo, Interesado, Esperando pago, Pago por verificar, Confirmado, Necesita ayuda…) se ponen solas.</p>
    </div>
    <div class="card section"><h3>🤖 Comportamiento</h3>
      ${fld("bot.enabled", "Bot encendido (responde automáticamente)", { type: "checkbox" })}
      ${fld("bot.handoffPausesBot", "Cuando pide ayuda humana, pausar el bot en ese chat", { type: "checkbox" })}
      <div class="grid cols-2" style="gap:10px">${fld("bot.handoffPauseHours", "Horas de pausa al pedir asesor", { type: "number" })}${fld("bot.pauseOnManualReplyHours", "Horas de pausa cuando respondés vos", { type: "number" })}</div>
      <p class="hint">Si respondés desde el panel o desde la app de WhatsApp Business (coexistencia), el bot se calla en ese chat por esas horas.</p>
    </div>
    <div class="card section"><h3>🔔 Avisos para vos</h3>
      ${fld("notify.ownerPhone", "Tu WhatsApp personal (con código de país)", { ph: "50370000000", hint: "Debe ser un número DISTINTO al del negocio. Para recibir avisos gratis, escribile 'hola' al número del negocio desde este número (abre una ventana de 24 h). Desde ahí también podés confirmar pagos con un botón." })}
      ${fld("notify.email", "Correo para avisos (respaldo)", { ph: "tucorreo@gmail.com", hint: "Usa Resend (gratis). Debe ser el mismo correo con el que creás tu cuenta en resend.com." })}
      ${fld("notify.onNewOrder", "Avisarme de pedidos nuevos", { type: "checkbox" })}
      ${fld("notify.onPayment", "Avisarme cuando llegue un comprobante", { type: "checkbox" })}
      ${fld("notify.onHuman", "Avisarme cuando un cliente necesite ayuda", { type: "checkbox" })}
    </div>
    <div class="card section"><h3>🔌 Conexiones</h3>
      ${fld("connections.phoneNumberId", "WhatsApp · Phone Number ID")}
      ${fld("connections.waToken", "WhatsApp · Token de acceso (permanente)", { type: "password" })}
      ${fld("connections.verifyToken", "WhatsApp · Token de verificación del webhook", { ph: "inventá una palabra secreta", hint: "Inventá una palabra (ej. nyxar-2026-secreto) y poné la misma en Meta." })}
      ${fld("connections.appSecret", "WhatsApp · App Secret (opcional, más seguridad)", { type: "password" })}
      ${fld("connections.geminiKey", "Gemini · API key (gratis en aistudio.google.com)", { type: "password" })}
      <div class="grid cols-2" style="gap:10px">${fld("connections.geminiModel", "Modelo principal")}${fld("connections.geminiFallbackModel", "Modelo de respaldo")}</div>
      ${fld("connections.groqKey", "Groq · API key (opcional, respaldo gratis)", { type: "password" })}
      ${fld("connections.groqModel", "Groq · modelo (respaldo)", { ph: "openai/gpt-oss-120b" })}
      ${fld("connections.resendKey", "Resend · API key (opcional, avisos por correo)", { type: "password" })}
      <div class="row" style="margin-top:10px"><button class="btn small" id="testAi">🧠 Probar IA</button><button class="btn small" id="testWa">📲 Enviarme mensaje de prueba</button></div>
    </div>
  </div>
  <div class="savebar"><button class="btn primary" id="saveCfg">💾 Guardar ajustes</button></div>`;
  renderAccounts(); renderFields();
  $("#addAccount").onclick = () => { collectCfg(); S.cfg.payments.accounts.push({ bank: "", type: "Ahorro", number: "", holder: "" }); renderAccounts(); };
  $("#addField").onclick = () => { collectCfg(); S.cfg.customerFields.push({ key: "", label: "", required: false }); renderFields(); };
  $("#saveCfg").onclick = saveCfg;
  $("#testAi").onclick = async () => { try { await saveCfg(true); const r = await api("test/ai", { method: "POST" }); toast("🧠 IA OK: " + (r.result?.saludo || "funciona"), 5000); } catch (e) { toast("⚠️ " + e.message, 7000); } };
  $("#testWa").onclick = async () => { try { await saveCfg(true); await api("test/whatsapp", { method: "POST", body: {} }); toast("📲 Mensaje enviado a tu WhatsApp ✅", 5000); } catch (e) { toast("⚠️ " + e.message, 9000); } };
}
function renderAccounts() {
  $("#accounts").innerHTML = S.cfg.payments.accounts.map((a, i) => `<div class="item">
    <input data-acc="${i}" data-k="bank" placeholder="Banco" value="${esc(a.bank)}"><input data-acc="${i}" data-k="type" placeholder="Tipo (Ahorro)" value="${esc(a.type)}">
    <input data-acc="${i}" data-k="number" placeholder="N.º de cuenta" value="${esc(a.number)}"><input data-acc="${i}" data-k="holder" placeholder="Titular" value="${esc(a.holder)}">
    <button class="btn small ghost" data-delacc="${i}">🗑️</button></div>`).join("");
  $$("[data-delacc]").forEach((b) => (b.onclick = () => { collectCfg(); S.cfg.payments.accounts.splice(+b.dataset.delacc, 1); renderAccounts(); }));
}
function renderFields() {
  $("#custFields").innerHTML = S.cfg.customerFields.map((f, i) => `<div class="item" style="grid-template-columns:1fr auto auto">
    <input data-fld="${i}" data-k="label" placeholder="Ej.: DUI" value="${esc(f.label)}">
    <label class="check" style="margin:0"><input type="checkbox" data-fld="${i}" data-k="required" ${f.required ? "checked" : ""}> Obligatorio</label>
    <button class="btn small ghost" data-delfld="${i}">🗑️</button></div>`).join("");
  $$("[data-delfld]").forEach((b) => (b.onclick = () => { collectCfg(); S.cfg.customerFields.splice(+b.dataset.delfld, 1); renderFields(); }));
}
function slug(s) { return normH(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "dato"; }
function collectCfg() {
  $$("[data-path]").forEach((el) => {
    if (el.disabled) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number") v = Number(v) || 0;
    setPath(S.cfg, el.dataset.path, v);
  });
  $$("[data-acc]").forEach((el) => (S.cfg.payments.accounts[+el.dataset.acc][el.dataset.k] = el.value.trim()));
  $$("[data-fld]").forEach((el) => {
    const f = S.cfg.customerFields[+el.dataset.fld];
    if (el.dataset.k === "required") f.required = el.checked; else f.label = el.value.trim();
  });
  const used = new Set();
  S.cfg.customerFields = S.cfg.customerFields.filter((f) => f.label).map((f) => {
    let key = f.key || slug(f.label); let k = key, i = 2; while (used.has(k)) k = `${key}_${i++}`; used.add(k); return { ...f, key: k };
  });
  const li = $("#labelsIn"); if (li) S.cfg.labels = li.value.split(",").map((x) => x.trim()).filter(Boolean);
}
async function saveCfg(silent) {
  collectCfg();
  S.cfg = await api("config", { method: "PUT", body: S.cfg });
  S.status = await api("status");
  $("#brandName").textContent = S.cfg.business.name;
  if (silent !== true) { toast("Ajustes guardados ✅"); viewConfig(); }
}

/* ---------------- Simulador ---------------- */
function viewSim() {
  $("#main").innerHTML = `<div class="page-head"><h2>🧪 Probar el bot</h2><span class="muted">Chateá como si fueras un cliente. No usa WhatsApp, pero sí la IA, tu catálogo y tus ajustes.</span><span class="spacer"></span><button class="btn small" id="simReset">🔄 Nueva conversación</button></div>
    <div class="phone">
      <div class="phone-head"><span style="font-size:22px">🛍️</span><div><b>${esc(S.cfg.business.name)}</b><div class="small" style="opacity:.85">bot de prueba</div></div></div>
      <div class="messages" id="simMsgs"><div class="empty">Escribí "hola" para empezar 👋</div></div>
      <div class="composer">
        <label class="btn small" style="margin:0" title="Enviar imagen (ej. comprobante)">📎<input type="file" id="simFile" accept="image/*,application/pdf" hidden></label>
        <textarea id="simText" placeholder="Escribí un mensaje…"></textarea>
        <button class="btn primary" id="simSend">➤</button>
      </div>
    </div>
    <p class="hint" style="text-align:center">Los pedidos de prueba aparecen en Pedidos → 🧪 Pruebas. Desde ahí podés confirmar el pago y ver cómo le avisa al cliente.</p>`;
  lsSet("simSession", S.simSession);
  const waId = "sim-" + S.simSession;
  viewSim.count = -1;
  const load = async () => {
    try {
      const { convo } = await api("conversations/" + waId);
      if (convo.messages.length !== viewSim.count) { viewSim.count = convo.messages.length; renderSim(convo.messages); }
    } catch { }
  };
  load();
  clearInterval(viewSim._t);
  viewSim._t = setInterval(() => { if (S.view === "simulador" && !viewSim.busy) load(); else if (S.view !== "simulador") clearInterval(viewSim._t); }, 5000);
  const send = async (payload) => {
    if (viewSim.busy) return;
    viewSim.busy = true;
    const msgs = $("#simMsgs");
    if (msgs.querySelector(".empty")) msgs.innerHTML = "";
    msgs.insertAdjacentHTML("beforeend", `<div class="msg">${payload.image ? "🖼️ Imagen" : waFmt(payload.text)}</div><div class="msg bot" id="typing">✍️ escribiendo…</div>`);
    msgs.scrollTop = msgs.scrollHeight;
    try { await api("simulate", { method: "POST", body: { session: S.simSession, ...payload } }); }
    catch (e) { toast("⚠️ " + e.message, 6000); }
    viewSim.busy = false;
    await load();
  };
  $("#simSend").onclick = () => { const t = $("#simText").value.trim(); if (!t) return; $("#simText").value = ""; send({ text: t }); };
  $("#simText").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#simSend").click(); } };
  $("#simFile").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 4 * 1024 * 1024) return toast("Imagen muy grande (máx. 4 MB)");
    const r = new FileReader();
    r.onload = () => send({ image: { mime: f.type || "image/jpeg", base64: String(r.result).split(",")[1] }, text: "" });
    r.readAsDataURL(f);
    e.target.value = "";
  };
  $("#simReset").onclick = async () => {
    try { await api("conversations/" + waId, { method: "DELETE" }); } catch {}
    S.simSession = Math.random().toString(36).slice(2, 10); lsSet("simSession", S.simSession); viewSim();
  };
  $("#simMsgs").onclick = (e) => {
    const b = e.target.closest("[data-simbtn]"); if (!b) return;
    send({ buttonId: b.dataset.simbtn, text: b.dataset.title });
  };
}
function renderSim(messages) {
  const el = $("#simMsgs"); if (!el) return;
  if (!messages.length) { el.innerHTML = `<div class="empty">Escribí "hola" para empezar 👋</div>`; return; }
  const lastBot = messages.length - 1;
  el.innerHTML = messages.map((m, i) => msgHtml({ ...m, from: m.from === "customer" ? "customer" : m.from }, m.from === "bot" && i >= lastBot - 3)).join("");
  el.scrollTop = el.scrollHeight;
}

/* ---------------- Inicio de la app ---------------- */
if (S.token) start(); else $("#login").classList.remove("hidden");
