/* ---------- word data: loaded from words.json as {id, word, ipa, pos, zh, ex, exZh, deck} ---------- */
let CARDS = [], BY_ID = {}, ORDER_ALL = [];
const DECK_NAME = {core:"生活單字", dev:"程式單字", algo:"演算法"};
function initCards(list){
  CARDS = list;
  BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
  /* "all" order: two everyday words, then one programming word, then one algorithms word */
  const a = CARDS.filter(c => c.deck === "core"), b = CARDS.filter(c => c.deck === "dev"), d = CARDS.filter(c => c.deck === "algo"), out = [];
  let i = 0, j = 0, k = 0;
  while (i < a.length || j < b.length || k < d.length){
    for (let n = 0; n < 2 && i < a.length; n++) out.push(a[i++]);
    if (j < b.length) out.push(b[j++]);
    if (k < d.length) out.push(d[k++]);
  }
  ORDER_ALL = out;
}
const IV = [0, 1, 2, 4, 7, 15, 30, 60]; // days until next review, by box
const LS_KEY = "ekko-words-v1";

/* ---------- state ---------- */
function todayNum(){ const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 864e5); }
function defaultState(){
  return {v:1, cards:{}, day:{d:0, nw:0, extra:0, done:[]}, streak:0, lastDone:-9, updatedAt:0,
    settings:{perDay:15, deck:"all", accent:"en-US", auto:true}};
}
function normalize(s){
  const d = defaultState();
  if (!s || typeof s !== "object") return d;
  return {...d, ...s, settings:{...d.settings, ...(s.settings || {})}, day:{...d.day, ...(s.day || {})}, cards:s.cards || {}};
}
let state = defaultState();

const Store = {
  loadLocal(){ try { const raw = localStorage.getItem(LS_KEY); if (raw) return normalize(JSON.parse(raw)); } catch(e){} return null; },
  saveLocal(){ try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e){} },
  save(){ state.updatedAt = Date.now(); this.saveLocal(); }
};

/* ---------- backup: export / import progress as JSON ---------- */
const BACKUP_APP = "ekko-words", BACKUP_V = 1;
const PER_DAY = [5, 10, 15, 20], DECKS = ["all", "core", "dev", "algo"];
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
const isInt = x => Number.isInteger(x);

function exportProgress(){
  const now = new Date(), pad = n => String(n).padStart(2, "0");
  const name = `ekko-words-progress-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
  const body = JSON.stringify({app:BACKUP_APP, v:BACKUP_V, exportedAt:now.toISOString(), state}, null, 2);
  const url = URL.createObjectURL(new Blob([body], {type:"application/json"}));
  const a = el("a"); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/* Returns {state, dropped, exportedAt} or throws Error with a user-facing message. */
function parseBackup(text){
  let data;
  try { data = JSON.parse(text); } catch(e){ throw new Error("檔案不是有效的 JSON。"); }
  if (!isObj(data) || data.app !== BACKUP_APP) throw new Error("這不是 EKKO 字卡的進度檔。");
  if (!isInt(data.v) || data.v > BACKUP_V) throw new Error("進度檔版本比這個 App 新，請先更新 App。");
  if (!isObj(data.state) || !isObj(data.state.cards)) throw new Error("進度檔缺少學習紀錄。");
  const s = normalize(data.state), d = defaultState();
  const cards = {};
  let dropped = 0;
  for (const [id, c] of Object.entries(s.cards)){
    const ok = BY_ID[id] && isObj(c) && (
      (c.s === "known" && isInt(c.t)) ||
      (c.s === "learn" && isInt(c.box) && c.box >= 0 && c.box < IV.length && isInt(c.due)));
    if (ok) cards[id] = c; else dropped++;
  }
  s.cards = cards;
  const S = s.settings;
  if (!PER_DAY.includes(S.perDay)) S.perDay = d.settings.perDay;
  if (!DECKS.includes(S.deck)) S.deck = d.settings.deck;
  if (typeof S.auto !== "boolean") S.auto = d.settings.auto;
  if (typeof S.accent !== "string") S.accent = d.settings.accent;
  const D = s.day;
  if (!isInt(D.d) || !isInt(D.nw) || !isInt(D.extra) || !Array.isArray(D.done)) s.day = d.day;
  else D.done = D.done.filter(id => typeof id === "string" && BY_ID[id]);
  if (!isInt(s.streak) || s.streak < 0) s.streak = 0;
  if (!isInt(s.lastDone)) s.lastDone = d.lastDone;
  return {state:s, dropped, exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : ""};
}

/* ---------- session ---------- */
let queue = [], cur = null, revealed = false, interacted = false;

function rollDay(){ const t = todayNum(); if (state.day.d !== t) state.day = {d:t, nw:0, extra:0, done:[]}; }
function deckList(){ const d = state.settings.deck; return d === "all" ? ORDER_ALL : CARDS.filter(c => c.deck === d); }
function newLeft(){ return deckList().filter(c => !state.cards[c.id]).length; }

function startSession(){
  rollDay();
  const t = state.day.d, list = deckList(), done = new Set(state.day.done);
  const rev = list.filter(c => { const s = state.cards[c.id]; return s && s.s === "learn" && s.due <= t && !done.has(c.id); })
    .sort((a, b) => state.cards[a.id].due - state.cards[b.id].due || state.cards[a.id].box - state.cards[b.id].box);
  const allow = Math.max(0, state.settings.perDay + state.day.extra - state.day.nw);
  const fresh = list.filter(c => !state.cards[c.id]).slice(0, allow);
  queue = [];
  let i = 0, j = 0;
  while (i < rev.length || j < fresh.length){
    for (let k = 0; k < 2 && i < rev.length; k++) queue.push({id:rev[i++].id, kind:"review"});
    if (j < fresh.length) queue.push({id:fresh[j++].id, kind:"new"});
  }
  next();
}

function next(){
  cur = queue.shift() || null;
  revealed = !!cur && cur.kind === "new";
  if (!cur) finishDay();
  render(true);
  if (cur && state.settings.auto && interacted) sayWord(BY_ID[cur.id]);
}

function reinsert(id, gap){ queue.splice(Math.min(gap, queue.length), 0, {id, kind:"review"}); }
function markDone(id){ if (!state.day.done.includes(id)) state.day.done.push(id); }

function finishDay(){
  const t = state.day.d;
  if (state.day.done.length > 0 && state.lastDone !== t){
    state.streak = state.lastDone === t - 1 ? state.streak + 1 : 1;
    state.lastDone = t;
    Store.save();
  }
}

function act(kind){
  if (!cur) return;
  const id = cur.id, t = state.day.d, c = state.cards[id];
  if (kind === "know"){ state.cards[id] = {s:"known", t}; state.day.nw++; markDone(id); }
  else if (kind === "learn"){ state.cards[id] = {s:"learn", box:0, due:t, n:0, l:0}; state.day.nw++; reinsert(id, 4); }
  else if (kind === "pass" && c){ c.box = Math.min((c.box || 0) + 1, IV.length - 1); c.due = t + IV[c.box]; c.n = (c.n || 0) + 1; markDone(id); }
  else if (kind === "fail" && c){ c.box = 0; c.l = (c.l || 0) + 1; c.due = t; reinsert(id, 3); }
  Store.save();
  next();
}

function reveal(){ if (!cur || revealed) return; revealed = true; render(false); if (interacted) sayWord(BY_ID[cur.id]); }

/* ---------- audio: pre-recorded clips audio/<id>.mp3 (word) and audio/<id>-ex.mp3 (example) ---------- */
/* ---------- speech ---------- */
const canSpeak = "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
let player = null;
/* Falls back to speech synthesis when the clip is missing or cannot be decoded. */
function playClip(src, fallbackText){
  try {
    if (player){ player.pause(); player.currentTime = 0; }
    if (canSpeak) try { speechSynthesis.cancel(); } catch(e){}
    const a = player = new Audio(src);
    a.addEventListener("error", () => { if (player === a) speak(fallbackText); });
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch(e){ speak(fallbackText); }
}
function sayWord(card){ playClip("audio/" + card.id + ".mp3", card.word); }
function saySentence(card){ playClip("audio/" + card.id + "-ex.mp3", card.ex); }
function pickVoice(lang){
  try {
    const vs = speechSynthesis.getVoices();
    return vs.find(v => v.lang === lang && /Google|Samantha|Daniel|Natural/i.test(v.name)) || vs.find(v => v.lang === lang) || vs.find(v => v.lang && v.lang.startsWith("en")) || null;
  } catch(e){ return null; }
}
function speak(text){
  if (!canSpeak || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.settings.accent;
    u.rate = /\s/.test(text) ? 0.92 : 0.82;
    const v = pickVoice(state.settings.accent);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch(e){}
}
if (canSpeak) try { speechSynthesis.onvoiceschanged = () => {}; speechSynthesis.getVoices(); } catch(e){}

/* ---------- generative card art ---------- */
function hash(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed){ return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function drawArt(canvas, card){
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d"), r = rng(hash(card.word));
  const base = card.deck === "dev" ? 190 + r() * 70 : card.deck === "algo" ? 135 + r() * 45 : 18 + r() * 40;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `hsl(${base - 10},45%,9%)`);
  bg.addColorStop(1, `hsl(${base + 25},50%,20%)`);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i++){
    const x = r() * W, y = r() * H, rad = (0.25 + r() * 0.45) * Math.max(W, H);
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `hsla(${base + r() * 50 - 25},85%,55%,${0.18 + r() * 0.2})`);
    rg.addColorStop(1, `hsla(${base},85%,50%,0)`);
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }
  const cx = W * (0.35 + r() * 0.3), cy = H * (0.35 + r() * 0.3);
  g.lineCap = "round";
  for (let i = 0; i < 16; i++){
    const a = r() * Math.PI * 2, len = (0.4 + r() * 0.8) * Math.max(W, H);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * len * 0.1, cy + Math.sin(a) * len * 0.1);
    g.bezierCurveTo(cx + Math.cos(a + 1.2) * len * 0.5, cy + Math.sin(a + 1.2) * len * 0.5,
                    cx + Math.cos(a - 0.8) * len * 0.7, cy + Math.sin(a - 0.8) * len * 0.7,
                    cx + Math.cos(a + 0.3) * len, cy + Math.sin(a + 0.3) * len);
    g.strokeStyle = `hsla(${base + 15},95%,${70 + r() * 15}%,${0.25 + r() * 0.45})`;
    g.lineWidth = (0.6 + r() * 2.4) * dpr;
    g.shadowColor = `hsla(${base + 5},100%,65%,.9)`;
    g.shadowBlur = 10 * dpr;
    g.stroke();
  }
  g.shadowBlur = 0;
  for (let i = 0; i < 90; i++){
    const x = r() * W, y = r() * H, s = (0.4 + r() * 1.6) * dpr;
    g.fillStyle = `hsla(${base + 20},100%,85%,${0.2 + r() * 0.7})`;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.35);
  core.addColorStop(0, `hsla(${base + 25},100%,85%,.55)`);
  core.addColorStop(1, `hsla(${base + 25},100%,70%,0)`);
  g.fillStyle = core; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "rgba(255,255,255,.13)";
  g.font = `900 ${Math.round(H * 0.62)}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.textAlign = "right"; g.textBaseline = "alphabetic";
  g.fillText(card.word[0].toUpperCase() + card.word.slice(1, 2), W * 0.95, H * 0.93);
}

/* ---------- rendering ---------- */
const $ = id => document.getElementById(id);
const ICON = {
  wave:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.3 4.3L19 7.2"/></svg>'
};
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function button(cls, label, fn){ const b = el("button", cls, label); b.type = "button"; b.addEventListener("click", fn); return b; }
function speakBtn(fn, dark, label){ const b = el("button", "spk" + (dark ? " dark" : "")); b.type = "button"; b.innerHTML = ICON.wave; b.setAttribute("aria-label", label); b.addEventListener("click", e => { e.stopPropagation(); fn(); }); return b; }

function counts(){
  let learning = 0, mastered = 0, known = 0;
  for (const k in state.cards){ const c = state.cards[k]; if (c.s === "known") known++; else if (c.s === "learn"){ if (c.box >= 5) mastered++; else learning++; } }
  return {learning, mastered, known, unseen: CARDS.length - learning - mastered - known};
}

function renderTop(){
  const c = counts(), t = state.day.d;
  $("knownNum").textContent = c.known;
  const ids = new Set(state.day.done);
  if (cur) ids.add(cur.id);
  queue.forEach(q => ids.add(q.id));
  $("doneNum").textContent = state.day.done.length;
  $("totalNum").textContent = ids.size;
  const alive = state.lastDone >= t - 1 ? state.streak : 0;
  $("streakNum").textContent = alive + " 天";
  $("streak").classList.toggle("off", state.lastDone !== t);
}

function buildExample(node, card){
  const text = card.ex, target = card.word;
  node.textContent = "";
  const key = target.toLowerCase().slice(0, Math.max(4, target.length - 2));
  text.split(/(\s+)/).forEach(part => {
    if (!part) return;
    if (/^\s+$/.test(part)){ node.append(part); return; }
    const clean = part.replace(/[^A-Za-z'-]/g, "");
    const s = el("span", "tok", part);
    if (clean.toLowerCase().startsWith(key)) s.classList.add("hit");
    const isHit = s.classList.contains("hit");
    s.addEventListener("click", e => { e.stopPropagation(); if (isHit) sayWord(card); else saySentence(card); });
    node.append(s);
  });
}

function renderCard(animate){
  const card = BY_ID[cur.id], s = state.cards[cur.id];
  const wrap = el("article", "card" + (animate ? " enter" : ""));
  const art = el("div", "art");
  const cv = el("canvas"); cv.setAttribute("aria-hidden", "true");
  art.append(cv, el("span", "tag", cur.kind === "new" ? "新字" : "複習"));
  wrap.append(art);

  const body = el("div", "body");
  const row = el("div", "word-row"), col = el("div", "word-col");
  col.append(el("h1", "word", card.word), el("div", "ipa", card.ipa));
  row.append(col, speakBtn(() => sayWord(card), false, "念出 " + card.word));
  body.append(row);

  if (revealed){
    const m = el("div", "meaning");
    m.append(el("span", "pos", card.pos), el("span", null, card.zh));
    body.append(m, el("hr", "rule"));
    const exRow = el("div", "ex-row"), ex = el("p", "ex");
    buildExample(ex, card);
    exRow.append(ex, speakBtn(() => saySentence(card), true, "念出例句"));
    body.append(exRow, el("p", "exzh", card.exZh));
  } else {
    body.append(el("hr", "rule"), el("div", "hint", "先在心裡說出它的中文意思，再按「顯示答案」。"));
  }

  const meta = el("div", "meta");
  meta.append(el("span", null, DECK_NAME[card.deck]));
  if (s && s.s === "learn"){
    meta.append(el("span", null, "·"), el("span", null, "熟練度"));
    const dots = el("span", "dots");
    for (let i = 1; i < IV.length; i++){ const d = el("i"); if (i <= s.box) d.className = "on"; dots.append(d); }
    meta.append(dots);
  }
  body.append(meta);
  wrap.append(body);
  wrap.addEventListener("click", () => { if (!revealed) reveal(); });
  $("stage").replaceChildren(wrap);
  requestAnimationFrame(() => { drawArt(cv, card); fitWord(); });
}

function fitWord(){
  const h = document.querySelector(".word");
  if (!h) return;
  h.style.fontSize = "";
  let size = parseFloat(getComputedStyle(h).fontSize);
  while (h.scrollWidth > h.clientWidth + 0.5 && size > 20){ size -= 1; h.style.fontSize = size + "px"; }
}

function renderDone(){
  const c = counts(), wrap = el("article", "card");
  const d = el("div", "done");
  const badge = el("div", "badge"); badge.innerHTML = ICON.check;
  const left = newLeft();
  const n = state.day.done.length;
  d.append(badge);
  if (n > 0){
    d.append(el("h2", null, "今天的份量完成了"), el("p", null, `今天處理了 ${n} 張卡。明天會出現該複習的字，記得回來。`));
  } else if (left === 0){
    d.append(el("h2", null, "這副牌的字都學過了"), el("p", null, "到期的字會自動回來複習。也可以在設定裡換牌組。"));
  } else {
    d.append(el("h2", null, "現在沒有要複習的字"), el("p", null, "今天的新字額度用完了，或是還沒開始。要的話可以多學幾個。"));
  }
  const st = el("div", "stats");
  [[c.learning, "學習中"], [c.mastered, "已熟練"], [c.known, "本來就會"], [c.unseen, "還沒看過"]].forEach(([v, l]) => {
    const s = el("div", "stat"); s.append(el("b", null, String(v)), el("span", null, l)); st.append(s);
  });
  d.append(st);
  wrap.append(d);
  $("stage").replaceChildren(wrap);
}

function renderActions(){
  const a = $("actions");
  a.replaceChildren();
  if (!cur){
    const left = newLeft();
    if (left > 0) a.append(button("btn strong wide", `再學 ${Math.min(5, left)} 個新字`, () => { state.day.extra += 5; Store.save(); startSession(); }));
    else a.append(button("btn wide", "打開設定", openSheet));
    return;
  }
  if (cur.kind === "new"){
    a.append(button("btn", "我知道了", () => act("know")), button("btn strong", "我要學習", () => act("learn")));
  } else if (!revealed){
    a.append(button("btn strong wide", "顯示答案", reveal));
  } else {
    a.append(button("btn", "不記得", () => act("fail")), button("btn strong", "記得", () => act("pass")));
  }
}

function render(animate){
  renderTop();
  if (cur) renderCard(animate); else renderDone();
  renderActions();
  $("stage").scrollTop = 0;
}

/* ---------- settings sheet ---------- */
let confirmReset = false;
function seg(node, options, value, onPick){
  node.replaceChildren();
  options.forEach(([v, label]) => {
    const b = button("", label, () => { onPick(v); renderSheet(); });
    b.setAttribute("aria-pressed", String(v === value));
    node.append(b);
  });
}
let pendingImport = null, backupMsg = "";
function renderBackup(){
  const bx = $("backup");
  bx.replaceChildren();
  if (pendingImport){
    const box = el("div", "confirm"), when = pendingImport.exportedAt ? new Date(pendingImport.exportedAt) : null;
    const n = Object.keys(pendingImport.state.cards).length;
    let text = `要用這個檔案${when && !isNaN(when) ? `（${when.toLocaleString()} 匯出）` : ""}的 ${n} 筆學習紀錄取代目前進度嗎？目前進度會被覆蓋。`;
    if (pendingImport.dropped) text += `另有 ${pendingImport.dropped} 筆對不到現有單字或格式不對，會略過。`;
    box.append(el("p", null, text),
      button("btn small", "取消", () => { pendingImport = null; renderSheet(); }),
      button("btn small strong", "確定匯入", () => {
        state = pendingImport.state; pendingImport = null; backupMsg = "已匯入進度。";
        Store.save(); startSession(); renderSheet();
      }));
    bx.append(box);
    return;
  }
  const row = el("div", "confirm");
  row.append(
    button("btn small", "匯出進度", () => { backupMsg = "已匯出 " + exportProgress(); renderSheet(); }),
    button("btn small", "匯入進度", () => $("importFile").click()));
  bx.append(row);
  if (backupMsg) bx.append(el("p", "note", backupMsg));
}
async function onImportFile(e){
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try { pendingImport = parseBackup(await f.text()); backupMsg = ""; }
  catch(err){ pendingImport = null; backupMsg = "匯入失敗：" + err.message; }
  renderSheet();
}
function renderSheet(){
  const c = counts(), st = $("sheetStats");
  st.replaceChildren();
  [[c.learning, "學習中"], [c.mastered, "已熟練"], [c.known, "本來就會"], [state.lastDone >= state.day.d - 1 ? state.streak : 0, "連續天數"]].forEach(([v, l]) => {
    const s = el("div", "stat"); s.append(el("b", null, String(v)), el("span", null, l)); st.append(s);
  });
  const S = state.settings;
  seg($("segPerDay"), [[5,"5"],[10,"10"],[15,"15"],[20,"20"]], S.perDay, v => { S.perDay = v; Store.save(); startSession(); });
  seg($("segDeck"), [["all","全部"],["core","生活"],["dev","程式"],["algo","演算法"]], S.deck, v => { S.deck = v; Store.save(); startSession(); });
  seg($("segAuto"), [[true,"開"],[false,"關"]], S.auto, v => { S.auto = v; Store.save(); });
  const dz = $("danger");
  dz.replaceChildren();
  if (!confirmReset){
    dz.append(button("btn small", "清除全部進度", () => { confirmReset = true; renderSheet(); }));
  } else {
    const box = el("div", "confirm");
    box.append(el("p", null, "所有學習紀錄和連續天數都會歸零，無法復原。"),
      button("btn small", "取消", () => { confirmReset = false; renderSheet(); }),
      button("btn small red", "確定清除", () => { const keep = state.settings; state = defaultState(); state.settings = keep; confirmReset = false; Store.save(); startSession(); renderSheet(); }));
    dz.append(box);
  }
  renderBackup();
}
function openSheet(){ confirmReset = false; pendingImport = null; backupMsg = ""; renderSheet(); $("scrim").hidden = false; $("sheet").hidden = false; }
function closeSheet(){ $("scrim").hidden = true; $("sheet").hidden = true; }
$("menuBtn").addEventListener("click", openSheet);
$("closeSheet").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
$("importFile").addEventListener("change", onImportFile);

/* ---------- input ---------- */
document.addEventListener("pointerdown", () => { interacted = true; }, {capture:true});
document.addEventListener("keydown", e => {
  interacted = true;
  if (!$("sheet").hidden){ if (e.key === "Escape") closeSheet(); return; }
  if (!cur) return;
  if (e.target && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
  if (e.key === " " || e.key === "Enter"){ e.preventDefault(); if (cur.kind === "review" && !revealed) reveal(); }
  else if (e.key === "ArrowLeft" || e.key === "1"){ if (cur.kind === "new") act("know"); else if (revealed) act("fail"); }
  else if (e.key === "ArrowRight" || e.key === "2"){ if (cur.kind === "new") act("learn"); else if (revealed) act("pass"); }
  else if (e.key.toLowerCase() === "s"){ sayWord(BY_ID[cur.id]); }
});
let rz = 0;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { const cv = document.querySelector(".art canvas"); if (cv && cur){ drawArt(cv, BY_ID[cur.id]); fitWord(); } }, 150); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && CARDS.length && todayNum() !== state.day.d) startSession(); });

/* ---------- service worker: offline cache + update prompt ---------- */
function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading){ reloading = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(reg => {
    const offer = w => {
      $("toast").hidden = false;
      $("toastBtn").onclick = () => { $("toastBtn").disabled = true; w.postMessage("skipWaiting"); };
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
}

/* ---------- boot ---------- */
async function boot(){
  try {
    const r = await fetch("words.json");
    if (!r.ok) throw new Error(r.status);
    initCards(await r.json());
  } catch(e){
    const box = el("div", "card"), d = el("div", "done");
    d.append(el("h2", null, "單字資料載入失敗"), el("p", null, "第一次開啟需要網路。請確認連線後重新整理。"),
      button("btn strong wide", "重新整理", () => location.reload()));
    box.append(d);
    $("stage").replaceChildren(box);
    return;
  }
  state = Store.loadLocal() || defaultState();
  startSession();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { const cv = document.querySelector(".art canvas"); if (cv && cur){ drawArt(cv, BY_ID[cur.id]); fitWord(); } });
}
boot();
registerSW();
