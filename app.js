// ============================
// MONE Frontend — Apps Script (GET payload) + listAllLite
// SIN notificaciones in-app
// Onboarding modal + wizard acompañado
// ============================

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywl4jUnYKYHYulF0LtZCHJgswGYCJWFWuZyiD2QhFVnUX1tWMZDbT5nkuAfqHgOg9bkQ/exec"; // .../exec

const LS_SESSION = "mone_session";
const LS_ONBOARD = "mone_onboard_seen";

function loadSession(){ try{return JSON.parse(localStorage.getItem(LS_SESSION));}catch{return null;} }
function saveSession(s){ localStorage.setItem(LS_SESSION, JSON.stringify(s)); }
function clearSession(){ localStorage.removeItem(LS_SESSION); }

async function api(action, payload={}){
  if (!SCRIPT_URL || SCRIPT_URL.includes("PEGA_AQUI")) throw new Error("Falta configurar SCRIPT_URL en app.js");
  const params = new URLSearchParams();
  params.set("action", action);
  params.set("payload", JSON.stringify(payload));
  const url = `${SCRIPT_URL}?${params.toString()}`;
  const res = await fetch(url, { method:"GET", cache:"no-store" });
  let data;
  try { data = await res.json(); }
  catch { throw new Error(`Respuesta no válida (HTTP ${res.status})`); }
  if(!data.ok) throw new Error(data.error || "API error");
  return data;
}

let DB = { me:null, users:[], requests:[], ratings:[] };
let BUSY = false;

function setBusy(on, msg="Cargando…"){
  BUSY = on;
  const el = document.getElementById("busyBar");
  if(!el) return;
  el.style.display = on ? "flex" : "none";
  const t = document.getElementById("busyText");
  if(t) t.textContent = msg;
}

function toast_(text){
  const el = document.getElementById("toast");
  if(!el) return;
  el.textContent = text;
  el.style.display = "block";
  el.classList.add("show");
  setTimeout(()=>{ el.classList.remove("show"); el.style.display="none"; }, 1300);
}

function truthy(v){
  if(v===true) return true;
  if(typeof v==="string") return v.toLowerCase()==="true";
  return Boolean(v);
}

function userRatingLabel(userId){
  const u = DB.users.find(x=>String(x.id)===String(userId));
  if(!u || !Number(u.ratingCount)) return "Sin valoraciones";
  const avg = (Number(u.ratingSum)/Number(u.ratingCount)).toFixed(1);
  return `${avg} / 5 (${u.ratingCount})`;
}

function hasRated(requestId, fromUserId){
  return DB.ratings.some(r => String(r.requestId)===String(requestId) && String(r.fromUserId)===String(fromUserId));
}

function statusChip(status){
  const map = {
    "NUEVA": { cls:"new", label:"Buscando acompañante" },
    "ACEPTADA": { cls:"accepted", label:"Acompañante asignado" },
    "CIERRE_SOLICITADO": { cls:"pending", label:"Confirma finalización" },
    "COMPLETADA": { cls:"accepted", label:"Completada" }
  };
  const m = map[status] || {cls:"", label:status};
  return `<span class="chip ${m.cls}">${m.label}</span>`;
}

/* ---------- AUTH ---------- */
async function moneRegister(){
  const name = (document.getElementById("regName")?.value || "").trim();
  const role = document.getElementById("regRole")?.value;
  const zone = document.getElementById("regZone")?.value;
  const adminPass = (document.getElementById("adminPass")?.value || "").trim();

  if(!name){ alert("Pon un nombre"); return; }
  if(!role){ alert("Elige un perfil"); return; }

  // si admin, exigir contraseña
  if(role === "admin" && !adminPass){
    alert("Introduce la contraseña de admin.");
    return;
  }

  try{
    setBusy(true, "Creando cuenta…");
    const data = await api("register",{name,role,zone, adminPass});
    saveSession({userId: data.user.id});
    window.location.href = "dashboard.html";
  } catch(e){
    alert("Error en registro: " + e.message);
  } finally {
    setBusy(false);
  }
}

async function moneLogin(){
  const name = (document.getElementById("name")?.value || "").trim();
  const role = (document.getElementById("role")?.value || "").trim();
  if(!name){ alert("Pon un nombre"); return; }
  if(!role){ alert("Elige un perfil"); return; }

  try{
    setBusy(true, "Entrando…");
    const data = await api("login",{name,role});
    saveSession({userId: data.user.id});
    window.location.href = "dashboard.html";
  } catch(e){
    alert("Login: " + e.message);
  } finally {
    setBusy(false);
  }
}

function moneLogout(){
  clearSession();
  window.location.href = "index.html";
}

/* ---------- BOOT / REFRESH ---------- */
async function moneBootDashboard(){
  const session = loadSession();
  if(!session?.userId){ window.location.href="index.html"; return; }

  try{
    setBusy(true, "Cargando…");
    const data = await api("listAllLite",{userId: session.userId});
    DB = {
      me: data.me,
      users: data.users||[],
      requests: data.requests||[],
      ratings: data.ratings||[]
    };

    const who = document.getElementById("whoami");
    if(who){
      const roleLabel = (DB.me.role==="acompañado" ? "Acompañado" : DB.me.role==="acompañante" ? "Acompañante" : "Admin");
      who.textContent = `${DB.me.name} · ${roleLabel} · ${DB.me.zone}`;
    }

    // show view by role
    const vA = document.getElementById("view-acompañado");
    const vAl = document.getElementById("view-acompañado-list");
    const vC = document.getElementById("view-acompañante");
    const vAd = document.getElementById("view-admin");

    if(vA) vA.style.display = "none";
    if(vAl) vAl.style.display = "none";
    if(vC) vC.style.display = "none";
    if(vAd) vAd.style.display = "none";

    if(DB.me.role==="acompañado"){
      if(vA) vA.style.display = "block";
      if(vAl) vAl.style.display = "block";
      wizStart();
    } else if(DB.me.role==="acompañante"){
      if(vC) vC.style.display = "block";
    } else {
      if(vAd) vAd.style.display = "block";
    }

    renderAll();
    maybeAutoOnboarding_();

  } catch(e){
    alert("Error cargando: " + e.message);
    moneLogout();
  } finally {
    setBusy(false);
  }
}

async function refreshLite_(msg="Actualizando…"){
  if(BUSY) return;
  try{
    setBusy(true, msg);
    const data = await api("listAllLite",{userId: DB.me.id});
    DB = {
      me: data.me,
      users: data.users||[],
      requests: data.requests||[],
      ratings: data.ratings||[]
    };
    renderAll();
  } finally {
    setBusy(false);
  }
}

/* ---------- WIZARD ACOMPAÑADO ---------- */
const WIZ = { step: 1, type: null, date: null, time: null, notes: "" };

function wizShow(step){
  WIZ.step = step;
  const s1 = document.getElementById("wizStep1");
  const s2 = document.getElementById("wizStep2");
  const s3 = document.getElementById("wizStep3");
  const s4 = document.getElementById("wizStep4");

  if(s1) s1.style.display = step===1 ? "block" : "none";
  if(s2) s2.style.display = step===2 ? "block" : "none";
  if(s3) s3.style.display = step===3 ? "block" : "none";
  if(s4) s4.style.display = step===4 ? "block" : "none";

  const p = document.getElementById("wizProgress");
  if(p) p.textContent = step<=3 ? `Paso ${step} de 3` : "Confirmar";

  const sum = document.getElementById("wizSummary");
  if(sum){
    const parts = [];
    if(WIZ.type) parts.push(WIZ.type);
    if(WIZ.date) parts.push(WIZ.date);
    if(WIZ.time) parts.push(WIZ.time);
    sum.textContent = parts.length ? parts.join(" · ") : "—";
  }

  // seleccion visual tiles
  document.querySelectorAll("[data-wiztype]").forEach(btn=>{
    btn.classList.toggle("selected", btn.getAttribute("data-wiztype")===WIZ.type);
  });
}

function wizStart(){
  WIZ.step = 1; WIZ.type=null; WIZ.date=null; WIZ.time=null; WIZ.notes="";
  const notes = document.getElementById("wizNotes");
  if(notes) notes.value="";
  const d = document.getElementById("wizDate");
  const t = document.getElementById("wizTime");
  if(d) d.value="";
  if(t) t.value="";
  wizShow(1);
}

function wizPickType(t){
  WIZ.type = t;
  wizShow(2);
}

function wizNextFromDate(){
  const d = document.getElementById("wizDate")?.value;
  if(!d){ alert("Elige un día"); return; }
  WIZ.date = d;
  wizShow(3);
}

function wizNextFromTime(){
  const t = document.getElementById("wizTime")?.value;
  if(!t){ alert("Elige una hora"); return; }
  WIZ.time = t;
  WIZ.notes = (document.getElementById("wizNotes")?.value || "").trim();
  wizShow(4);
}

function wizBack(){
  if(WIZ.step===2) wizShow(1);
  else if(WIZ.step===3) wizShow(2);
  else if(WIZ.step===4) wizShow(3);
}

async function wizConfirm(){
  if(!WIZ.type || !WIZ.date || !WIZ.time){
    alert("Falta completar la solicitud.");
    return;
  }
  const when = `${WIZ.date} ${WIZ.time}${WIZ.notes ? " · " + WIZ.notes : ""}`;

  try{
    await api("createRequest",{userId: DB.me.id, type: WIZ.type, when});
    await refreshLite_("Guardando…");
    toast_("Solicitud enviada");
    wizStart();
  } catch(e){
    alert("Error creando: " + e.message);
  }
}

/* ---------- REQUESTS ---------- */
async function moneClaimRequest(requestId){
  try{
    await api("claimRequest",{companionId: DB.me.id, requestId});
    await refreshLite_("Aceptando…");
    toast_("Aceptada");
  } catch(e){
    alert("No se pudo aceptar: " + e.message);
  }
}

async function moneRequestClose(requestId){
  try{
    await api("requestClose",{companionId: DB.me.id, requestId});
    await refreshLite_("Guardando…");
    toast_("Cierre solicitado");
  } catch(e){
    alert("Error: " + e.message);
  }
}

async function moneConfirmClose(requestId){
  try{
    await api("confirmClose",{accompaniedId: DB.me.id, requestId});
    await refreshLite_("Guardando…");
    toast_("Confirmado");
  } catch(e){
    alert("Error: " + e.message);
  }
}

/* ---------- RATINGS (stars) ---------- */
function starsWidgetHTML(requestId, targetUserId){
  const id = `stars_${requestId}_${targetUserId}`;
  return `
    <div class="starbox" role="group" aria-label="Valoración de 1 a 5">
      <div class="stars" id="${id}">
        ${[1,2,3,4,5].map(n=>`
          <button class="starbtn" type="button" aria-label="${n} estrellas"
            onclick="moneClickStar('${requestId}','${targetUserId}',${n})">★</button>
        `).join("")}
      </div>
      <div class="starhint">Toca una estrella</div>
    </div>
  `;
}

function paintStars(containerId,n){
  const box = document.getElementById(containerId);
  if(!box) return;
  box.querySelectorAll(".starbtn").forEach((b,i)=>b.classList.toggle("on", i<n));
}

async function moneClickStar(requestId, targetUserId, score){
  if(hasRated(requestId, DB.me.id)){
    alert("Ya has valorado este acompañamiento.");
    return;
  }
  paintStars(`stars_${requestId}_${targetUserId}`, score);

  try{
    await api("submitRating",{fromUserId: DB.me.id, requestId, toUserId: targetUserId, score});
    await refreshLite_("Guardando…");
    toast_("Valoración enviada");
  } catch(e){
    alert("Error: " + e.message);
  }
}

/* ---------- ADMIN ---------- */
async function moneToggleVerified(userId, nextVal){
  try{
    await api("setUserVerified",{adminId: DB.me.id, userId, verified: nextVal});
    await refreshLite_("Actualizando…");
    toast_("Actualizado");
  } catch(e){
    alert("Error: " + e.message);
  }
}

/* ---------- RENDER ---------- */
function renderAll(){
  if(DB.me.role==="acompañado") renderAccompanied();
  if(DB.me.role==="acompañante") renderCompanion();
  if(DB.me.role==="admin") renderAdmin();
}

function renderAccompanied(){
  const list = document.getElementById("myRequests");
  if(!list) return;

  const reqs = DB.requests
    .filter(r=>String(r.accompaniedId)===String(DB.me.id))
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));

  if(!reqs.length){
    list.innerHTML = `<div class="item"><p class="muted">Aún no tienes solicitudes. Crea una arriba.</p></div>`;
    return;
  }

  list.innerHTML = reqs.map(r=>{
    const showComp = (["ACEPTADA","CIERRE_SOLICITADO","COMPLETADA"].includes(r.status))
      ? `<p class="meta"><b>Acompañante:</b> ${r.companionName} · <span class="muted small">${userRatingLabel(r.companionId)}</span></p>` : "";

    const confirmBtn = (r.status==="CIERRE_SOLICITADO")
      ? `<div class="actions"><button class="btn primary" onclick="moneConfirmClose('${r.id}')">Confirmar finalización</button></div>` : "";

    const rateBlock = (r.status==="COMPLETADA" && !hasRated(r.id, DB.me.id))
      ? starsWidgetHTML(r.id, r.companionId)
      : (r.status==="COMPLETADA" ? `<div class="muted small" style="margin-top:10px;">Gracias, valoración enviada.</div>` : "");

    return `
      <div class="item">
        <h4>${r.type}</h4>
        <p class="meta"><b>Cuándo:</b> ${r.when}</p>
        ${showComp}
        ${statusChip(r.status)}
        ${confirmBtn}
        ${rateBlock}
      </div>
    `;
  }).join("");
}

function renderCompanion(){
  const avail = document.getElementById("availableRequests");
  const active = document.getElementById("myAssignmentsActive");
  if(!avail || !active) return;

  const available = DB.requests
    .filter(r=>r.status==="NUEVA" && r.zone===DB.me.zone)
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));

  if(!available.length){
    avail.innerHTML = `<div class="item"><p class="muted">No hay solicitudes nuevas ahora mismo.</p></div>`;
  } else {
    avail.innerHTML = available.map(r=>`
      <div class="item">
        <h4>${r.type}</h4>
        <p class="meta">${r.when}</p>
        <p class="meta muted small">${r.accompaniedName} · ${r.zone}</p>
        <div class="actions">
          <button class="btn primary" onclick="moneClaimRequest('${r.id}')">Aceptar</button>
        </div>
      </div>
    `).join("");
  }

  const mineShow = DB.requests
    .filter(r=>String(r.companionId)===String(DB.me.id))
    .filter(r=>["ACEPTADA","CIERRE_SOLICITADO","COMPLETADA"].includes(r.status))
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));

  if(!mineShow.length){
    active.innerHTML = `<div class="item"><p class="muted">No tienes acompañamientos aún.</p></div>`;
    return;
  }

  active.innerHTML = mineShow.map(r=>{
    const closeBtn = (r.status==="ACEPTADA")
      ? `<div class="actions"><button class="btn primary" onclick="moneRequestClose('${r.id}')">Marcar finalizado</button></div>` : "";

    const waiting = (r.status==="CIERRE_SOLICITADO")
      ? `<div class="muted small" style="margin-top:10px;">Esperando confirmación del acompañado…</div>` : "";

    const rateBlock = (r.status==="COMPLETADA" && !hasRated(r.id, DB.me.id))
      ? starsWidgetHTML(r.id, r.accompaniedId)
      : (r.status==="COMPLETADA" ? `<div class="muted small" style="margin-top:10px;">Valoración enviada.</div>` : "");

    return `
      <div class="item">
        <h4>${r.type}</h4>
        <p class="meta"><b>Cuándo:</b> ${r.when}</p>
        <p class="meta muted small">${r.accompaniedName} · ${r.zone}</p>
        ${statusChip(r.status)}
        ${closeBtn}
        ${waiting}
        ${rateBlock}
      </div>
    `;
  }).join("");
}

function renderAdmin(){
  const box = document.getElementById("adminUsers");
  if(!box) return;

  const companions = DB.users
    .filter(u=>u.role==="acompañante")
    .sort((a,b)=>String(a.name).localeCompare(String(b.name)));

  if(!companions.length){
    box.innerHTML = `<div class="item"><p class="muted">No hay acompañantes aún.</p></div>`;
    return;
  }

  box.innerHTML = companions.map(u=>{
    const isV = truthy(u.verified);
    return `
      <div class="item">
        <h4>${u.name}</h4>
        <p class="meta"><b>${u.zone}</b> · ${isV ? "Verificado" : "No verificado"}</p>
        <p class="meta muted small">${userRatingLabel(u.id)}</p>
        <div class="actions">
          <button class="btn ${isV ? "danger" : "primary"}"
            onclick="moneToggleVerified('${u.id}', ${isV ? "false" : "true"})">
            ${isV ? "Quitar verificación" : "Verificar"}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

/* ---------- Onboarding ---------- */
let ON_IDX = 1;

function maybeAutoOnboarding_(){
  try{
    const seen = localStorage.getItem(LS_ONBOARD);
    if(!seen){
      moneOpenOnboarding();
    }
  } catch(e){}
}

function moneOpenOnboarding(){
  const ov = document.getElementById("onboardOverlay");
  if(!ov) return;
  ov.style.display = "flex";
  ov.setAttribute("aria-hidden","false");
  ON_IDX = 1;
  renderOn_();
}

function moneCloseOnboarding(){
  const ov = document.getElementById("onboardOverlay");
  if(!ov) return;
  ov.style.display = "none";
  ov.setAttribute("aria-hidden","true");
  try{ localStorage.setItem(LS_ONBOARD, "1"); } catch(e){}
}

function moneOnNext(){
  if(ON_IDX < 3){
    ON_IDX++;
    renderOn_();
  } else {
    moneCloseOnboarding();
  }
}
function moneOnPrev(){
  if(ON_IDX > 1){
    ON_IDX--;
    renderOn_();
  }
}

function renderOn_(){
  const s1 = document.getElementById("slide1");
  const s2 = document.getElementById("slide2");
  const s3 = document.getElementById("slide3");
  if(s1) s1.classList.toggle("on", ON_IDX===1);
  if(s2) s2.classList.toggle("on", ON_IDX===2);
  if(s3) s3.classList.toggle("on", ON_IDX===3);

  const dots = document.getElementById("onDots");
  if(dots){
    [...dots.querySelectorAll(".dot")].forEach((d,i)=>d.classList.toggle("on", i===ON_IDX-1));
  }

  const btn = document.getElementById("onNextBtn");
  if(btn) btn.textContent = (ON_IDX===3) ? "Comenzar" : "Siguiente";
}

/* ---------- expose ---------- */
window.moneRegister = moneRegister;
window.moneLogin = moneLogin;
window.moneBootDashboard = moneBootDashboard;
window.moneLogout = moneLogout;

window.wizStart = wizStart;
window.wizPickType = wizPickType;
window.wizNextFromDate = wizNextFromDate;
window.wizNextFromTime = wizNextFromTime;
window.wizBack = wizBack;
window.wizConfirm = wizConfirm;

window.moneClaimRequest = moneClaimRequest;
window.moneRequestClose = moneRequestClose;
window.moneConfirmClose = moneConfirmClose;

window.moneClickStar = moneClickStar;
window.moneToggleVerified = moneToggleVerified;

window.moneOpenOnboarding = moneOpenOnboarding;
window.moneCloseOnboarding = moneCloseOnboarding;
window.moneOnNext = moneOnNext;
window.moneOnPrev = moneOnPrev;
