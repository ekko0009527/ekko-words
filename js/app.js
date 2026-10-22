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
const LS_KEY = "ekko-words-v1";            // key kept across format versions; state.v tells the format
const LS_PRE_FSRS = "ekko-words-v1-pre-fsrs"; // untouched copy of v1 progress, written once before migrating
const DAY = 864e5;
const MASTERED_DAYS = 21;                    // stability at which a word counts as "已熟練"
const DOT_DAYS = [1, 2, 4, 7, 15, 30, 60];   // stability thresholds for the 熟練度 dots on a card

/* ---------- state ---------- */
/* Day numbers count local calendar days; a card is due on the local day its `due` timestamp falls in. */
const dayOf = ms => { const d = new Date(ms); return Math.floor((ms - d.getTimezoneOffset() * 60000) / DAY); };
function todayNum(){ return dayOf(Date.now()); }
function dayStart(n){ const u = new Date(n * DAY); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime(); }
function defaultState(){
  return {v:2, cards:{}, day:{d:0, nw:0, extra:0, done:[]}, streak:0, lastDone:-9, updatedAt:0, log:{},
    settings:{perDay:15, deck:"all", accent:"en-US", auto:true, buttons:3, retention:0.9}};
}
function normalize(s){
  const d = defaultState();
  if (!s || typeof s !== "object") return d;
  return {...d, ...s, settings:{...d.settings, ...(s.settings || {})}, day:{...d.day, ...(s.day || {})}, cards:s.cards || {},
    log: s.log && typeof s.log === "object" && !Array.isArray(s.log) ? s.log : {}};
}
let state = defaultState();

/* v1 (fixed-interval boxes) -> v2 (FSRS cards). Also used for v1 backup files.
   learn {box, due, n, l}: keep the due day, stability = that box's interval.
   known {t}: never tested, so it comes back for a check, spread over the next 28 days. */
const IV_V1 = [0, 1, 2, 4, 7, 15, 30, 60];
function migrateV1(s){
  const t = todayNum(), cards = {};
  for (const [id, c] of Object.entries(isObj(s.cards) ? s.cards : {})){
    if (!isObj(c)) continue;
    if (c.s === "learn" && isInt(c.box) && c.box >= 0 && c.box < IV_V1.length && isInt(c.due)){
      const iv = IV_V1[c.box];
      cards[id] = {due: dayStart(c.due), stability: Math.max(1, iv), difficulty: Math.min(10, Math.max(1, 5 + 0.5 * (c.l || 0))),
        scheduled_days: iv, learning_steps: 0, reps: c.n || 0, lapses: c.l || 0, state: 2, last_review: dayStart(c.due - iv)};
    } else if (c.s === "known"){
      const due = dayStart(t + 1 + hash(id) % 28);
      cards[id] = {due, stability: 30, difficulty: 4, scheduled_days: 30, learning_steps: 0, reps: 1, lapses: 0, state: 2,
        last_review: due - 30 * DAY, chk: true};
    }
  }
  const out = normalize({...s, cards, v: 2});
  out.settings = {...defaultState().settings, ...(isObj(s.settings) ? s.settings : {}), buttons: 3, retention: 0.9};
  return out;
}

const Store = {
  loadLocal(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (isObj(s) && !(s.v >= 2)){
        if (!localStorage.getItem(LS_PRE_FSRS)) localStorage.setItem(LS_PRE_FSRS, raw);
        const up = migrateV1(s);
        localStorage.setItem(LS_KEY, JSON.stringify(up));
        return up;
      }
      return normalize(s);
    } catch(e){}
    return null;
  },
  saveLocal(){ try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e){} },
  save(){ state.updatedAt = Date.now(); this.saveLocal(); }
};

/* ---------- backup: export / import progress as JSON ---------- */
const BACKUP_APP = "ekko-words", BACKUP_V = 2;
const PER_DAY = [5, 10, 15, 20], DECKS = ["all", "core", "dev", "algo"], BUTTONS = [2, 3], RETENTION = [0.85, 0.9, 0.95];
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
const isInt = x => Number.isInteger(x);
const isNum = x => typeof x === "number" && Number.isFinite(x);
function validCard(c){
  return isObj(c) && isNum(c.due) && isNum(c.stability) && c.stability >= 0 && isNum(c.difficulty) && c.difficulty >= 0 && c.difficulty <= 10
    && isInt(c.state) && c.state >= 0 && c.state <= 3 && isInt(c.reps) && c.reps >= 0 && isInt(c.lapses) && c.lapses >= 0
    && (c.last_review === undefined || isNum(c.last_review)) && (c.chk === undefined || typeof c.chk === "boolean");
}

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
  const total = Object.keys(data.state.cards).length;
  const s = data.v < 2 ? migrateV1(data.state) : normalize(data.state), d = defaultState();
  const cards = {};
  for (const [id, c] of Object.entries(s.cards)) if (BY_ID[id] && validCard(c)) cards[id] = c;
  const dropped = total - Object.keys(cards).length;
  s.cards = cards;
  const S = s.settings;
  if (!PER_DAY.includes(S.perDay)) S.perDay = d.settings.perDay;
  if (!DECKS.includes(S.deck)) S.deck = d.settings.deck;
  if (typeof S.auto !== "boolean") S.auto = d.settings.auto;
  if (typeof S.accent !== "string") S.accent = d.settings.accent;
  if (!BUTTONS.includes(S.buttons)) S.buttons = d.settings.buttons;
  if (!RETENTION.includes(S.retention)) S.retention = d.settings.retention;
  const D = s.day;
  if (!isInt(D.d) || !isInt(D.nw) || !isInt(D.extra) || !Array.isArray(D.done)) s.day = d.day;
  else D.done = D.done.filter(id => typeof id === "string" && BY_ID[id]);
  if (!isInt(s.streak) || s.streak < 0) s.streak = 0;
  if (!isInt(s.lastDone)) s.lastDone = d.lastDone;
  const log = {};
  for (const [k, v] of Object.entries(s.log)) if (/^-?\d+$/.test(k) && isInt(v) && v >= 0) log[k] = v;
  s.log = log;
  return {state:s, dropped, exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : ""};
}

/* ---------- session ---------- */
/* view: "home" = dashboard, "study" = one card at a time */
let queue = [], cur = null, revealed = false, interacted = false, view = "home";

function rollDay(){ const t = todayNum(); if (state.day.d !== t) state.day = {d:t, nw:0, extra:0, done:[]}; }
function deckList(){ const d = state.settings.deck; return d === "all" ? ORDER_ALL : CARDS.filter(c => c.deck === d); }
function newLeft(){ return deckList().filter(c => !state.cards[c.id]).length; }

function startSession(){
  rollDay();
  const t = state.day.d, list = deckList(), done = new Set(state.day.done);
  const rev = list.filter(c => { const s = state.cards[c.id]; return s && dayOf(s.due) <= t && !done.has(c.id); })
    .sort((a, b) => state.cards[a.id].due - state.cards[b.id].due);
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
  if (cur && view === "study" && state.settings.auto && interacted) sayWord(BY_ID[cur.id]);
}

/* kind "review" is graded by FSRS; "practice" is the same-day retry after 忘了 and does not change the schedule */
function reinsert(id, gap, kind = "review"){ queue.splice(Math.min(gap, queue.length), 0, {id, kind}); }
/* state.log[dayNum] = cards finished that day (feeds the week strip on the home screen) */
function markDone(id){
  if (!state.day.done.includes(id)) state.day.done.push(id);
  state.log[state.day.d] = state.day.done.length;
}

function finishDay(){
  const t = state.day.d;
  if (state.day.done.length > 0 && state.lastDone !== t){
    state.streak = state.lastDone === t - 1 ? state.streak + 1 : 1;
    state.lastDone = t;
    Store.save();
  }
}

/* ---------- scheduling: FSRS (js/vendor/ts-fsrs.umd.js, global FSRS) ---------- */
let scheduler = null;
function makeScheduler(){
  scheduler = FSRS.fsrs(FSRS.generatorParameters({request_retention: state.settings.retention,
    enable_fuzz: true, enable_short_term: false, maximum_interval: 3650}));
}
/* Stored cards keep dates as millisecond numbers; ts-fsrs accepts those and returns Dates. */
function schedule(id, rating, now = Date.now()){
  const old = state.cards[id], base = old ? {...old, elapsed_days: 0} : FSRS.createEmptyCard(now);
  const c = scheduler.next(base, now, rating).card;
  state.cards[id] = {due: +c.due, stability: c.stability, difficulty: c.difficulty, scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state, last_review: c.last_review ? +c.last_review : undefined};
}

/* kind: know / learn (new word), again / hard / good (graded review), "practice-*" (same-day retry) */
function act(kind){
  if (!cur) return;
  const id = cur.id, R = FSRS.Rating;
  if (cur.kind === "practice"){
    if (kind === "again") reinsert(id, 3, "practice"); else markDone(id);
  } else if (kind === "know"){
    schedule(id, R.Easy); state.day.nw++; markDone(id);          // first rating: Easy -> checked again in about a week
  } else if (kind === "learn"){
    const c = FSRS.createEmptyCard(Date.now());                  // not graded yet: the first real answer comes later today
    state.cards[id] = {due: +c.due, stability: 0, difficulty: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0};
    state.day.nw++; reinsert(id, 4);
  } else if (state.cards[id]){
    schedule(id, kind === "again" ? R.Again : kind === "hard" ? R.Hard : R.Good);
    if (kind === "again") reinsert(id, 3, "practice"); else markDone(id);
  }
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

/* learning: seen, stability < 21 days; mastered: >= 21 days; pending: old "本來就會" words not yet re-tested */
function counts(){
  let learning = 0, mastered = 0, pending = 0;
  for (const k in state.cards){ const c = state.cards[k]; if (c.chk) pending++; else if (c.stability >= MASTERED_DAYS) mastered++; else learning++; }
  return {learning, mastered, pending, unseen: CARDS.length - learning - mastered - pending};
}

function renderTop(){
  const c = counts(), t = state.day.d;
  $("knownNum").textContent = c.mastered;
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
  const cv = el("canvas"); cv.setAttribute("aria-hidden", "true"); cv.dataset.id = card.id;
  art.append(cv, el("span", "tag", cur.kind === "new" ? "新字" : cur.kind === "practice" ? "再練一次" : s && s.chk ? "確認一下" : "複習"));
  /* Memory cue: shown only with the answer, so review cards still test recall */
  if (revealed && card.emoji){ const e = el("span", "emo", card.emoji); e.setAttribute("aria-hidden", "true"); art.append(e); }
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
  if (s && s.reps > 0 && !s.chk){
    meta.append(el("span", null, "·"), el("span", null, "熟練度"));
    const dots = el("span", "dots");
    DOT_DAYS.forEach(n => { const d = el("i"); if (s.stability >= n) d.className = "on"; dots.append(d); });
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
  [[c.learning, "學習中"], [c.mastered, "已熟練"], [c.pending, "待確認"], [c.unseen, "還沒看過"]].forEach(([v, l]) => {
    const s = el("div", "stat"); s.append(el("b", null, String(v)), el("span", null, l)); st.append(s);
  });
  d.append(st);
  wrap.append(d);
  $("stage").replaceChildren(wrap);
}

/* ---------- home dashboard ---------- */
const DOW = ["日", "一", "二", "三", "四", "五", "六"];
const SEC_PER_CARD = 20; // rough guess behind the "約 n 分" estimate
const dayDate = n => new Date(n * 864e5); // dayNum -> Date whose UTC fields are that local date

/* Days with any finished card: state.log, plus today's list and the current streak run for progress saved before log existed */
function studiedDays(){
  const days = new Set(Object.keys(state.log).filter(k => state.log[k] > 0).map(Number));
  if (state.day.done.length) days.add(state.day.d);
  if (state.streak > 0) for (let d = state.lastDone - state.streak + 1; d <= state.lastDone; d++) days.add(d);
  return days;
}
function today(){
  const remaining = [], seen = new Set();
  [cur, ...queue].forEach(q => { if (q && !seen.has(q.id)){ seen.add(q.id); remaining.push(q); } });
  const done = state.day.done.filter(id => !seen.has(id));
  return {remaining, done, total: remaining.length + done.length};
}
/* Day the last new word of the deck gets introduced at the current pace */
function newWordsDone(){
  const left = newLeft(), t = state.day.d, per = state.settings.perDay;
  const allowToday = Math.max(0, per + state.day.extra - state.day.nw);
  const after = Math.max(0, left - allowToday);
  return {left, day: after === 0 ? t : t + Math.ceil(after / per)};
}
function ring(p){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20"); svg.setAttribute("aria-hidden", "true"); svg.classList.add("ring");
  const len = 2 * Math.PI * 8;
  svg.innerHTML = `<circle cx="10" cy="10" r="8"/><circle cx="10" cy="10" r="8" class="on" stroke-dasharray="${(p * len).toFixed(2)} ${len.toFixed(2)}"/>`;
  return svg;
}

function renderHome(){
  const t = state.day.d, list = deckList();
  const seenN = list.filter(c => state.cards[c.id]).length, pct = list.length ? seenN / list.length : 0;
  const home = el("div", "home");

  const head = el("div", "home-head"), title = el("div", "home-title");
  title.append(el("h1", null, "EKKO 字卡"), el("span", null, state.settings.deck === "all" ? "全部牌組" : DECK_NAME[state.settings.deck]));
  const goal = el("div", "goal"), pctTxt = Math.round(pct * 1000) / 10 + "%";
  const eta = newWordsDone(), dd = eta.day - t, date = dayDate(eta.day);
  goal.append(ring(pct), el("b", null, pctTxt), el("span", "sep"), el("b", null, eta.left ? "D-" + dd : "完成"));
  goal.title = `已看過 ${seenN} / ${list.length} 個字`;
  const menu = button("icon-btn", null, openSheet);
  menu.setAttribute("aria-label", "設定"); menu.innerHTML = $("menuBtn").innerHTML;
  head.append(title, goal, menu);
  const sub = el("p", "home-sub", eta.left
    ? `照每天 ${state.settings.perDay} 個新字，預估 ${date.getUTCMonth() + 1}/${date.getUTCDate()} 學完這副牌的新字`
    : "這副牌的新字都學過了，之後只剩複習");
  home.append(head, sub);

  const studied = studiedDays(), dow = dayDate(t).getUTCDay();
  const alive = state.lastDone >= t - 1 ? state.streak : 0;
  const weekHead = el("div", "week-head");
  weekHead.append(el("span", null, "本週"), el("span", null, alive ? `連續 ${alive} 天` : "完成今天的份量就開始累積連續天數"));
  const week = el("div", "week");
  for (let i = 0; i < 7; i++){
    const d = t - dow + i, dt = dayDate(d), cell = el("div", "wd");
    if (d === t) cell.classList.add("today");
    if (d > t) cell.classList.add("future");
    if (studied.has(d)) cell.classList.add("studied");
    cell.setAttribute("aria-label", `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日${d === t ? "，今天" : ""}${studied.has(d) ? "，有學習" : ""}`);
    cell.append(el("span", "dow", DOW[i]), el("span", "dt", String(dt.getUTCDate())));
    week.append(cell);
  }
  home.append(weekHead, week);

  const T = today(), dayN = studied.size + (studied.has(t) ? 0 : 1);
  home.append(el("h2", "day-n", `第 ${dayN} 天`));
  const card = el("article", "card today-card");
  if (T.total){
    const thumbs = el("div", "thumbs"), draw = [];
    [...T.remaining.map(q => q.id), ...T.done].slice(0, 8).forEach(id => {
      const c = BY_ID[id], th = el("div", "thumb" + (T.done.includes(id) ? " fin" : ""));
      const cv = el("canvas"); cv.setAttribute("aria-hidden", "true"); cv.dataset.id = id;
      th.append(cv, el("span", null, c.word));
      thumbs.append(th); draw.push([cv, c]);
    });
    requestAnimationFrame(() => draw.forEach(([cv, c]) => drawArt(cv, c)));
    card.append(thumbs);
  }
  const body = el("div", "today-body");
  const nNew = T.remaining.filter(q => q.kind === "new").length, nRev = T.remaining.length - nNew, doneN = T.done.length;
  body.append(el("h3", null, "今日學習"));
  const bar = el("div", "bar"), fill = el("i");
  fill.style.width = (T.total ? doneN / T.total * 100 : 0) + "%";
  bar.append(fill);
  const row = el("div", "prog-row");
  const status = !T.total ? "今天沒有排到卡片" : !T.remaining.length ? "今天完成" : doneN ? `進行中 ${doneN} / ${T.total}` : "尚未開始";
  row.append(el("span", null, status), el("span", null, T.remaining.length ? `約 ${Math.max(1, Math.ceil(T.remaining.length * SEC_PER_CARD / 60))} 分` : ""));
  body.append(bar, row);
  if (T.remaining.length) body.append(el("p", "today-note", `新字 ${nNew} 個・複習 ${nRev} 個`));
  card.append(body);
  home.append(card);
  $("stage").replaceChildren(home);
}

function learnMore(){ state.day.extra += 5; Store.save(); view = "study"; startSession(); }
function startStudy(){
  view = "study";
  render(true);
  if (cur && state.settings.auto && interacted) sayWord(BY_ID[cur.id]);
}
function goHome(){
  if (player) try { player.pause(); } catch(e){}
  view = "home";
  render(false);
}

function renderActions(){
  const a = $("actions");
  a.replaceChildren();
  a.classList.remove("three");
  if (view === "home"){
    const T = today(), left = newLeft();
    if (T.remaining.length) a.append(button("btn strong wide", T.done.length ? "繼續" : "立即開始", startStudy));
    else if (left > 0) a.append(button("btn strong wide", `再學 ${Math.min(5, left)} 個新字`, learnMore));
    else a.append(button("btn wide", "打開設定", openSheet));
    return;
  }
  if (!cur){
    const left = newLeft();
    a.append(button("btn", "回首頁", goHome));
    if (left > 0) a.append(button("btn strong", `再學 ${Math.min(5, left)} 個新字`, learnMore));
    else a.append(button("btn", "打開設定", openSheet));
    return;
  }
  if (cur.kind === "new"){
    a.append(button("btn", "我知道了", () => act("know")), button("btn strong", "我要學習", () => act("learn")));
  } else if (!revealed){
    a.append(button("btn strong wide", "顯示答案", reveal));
  } else if (cur.kind === "practice" || state.settings.buttons === 2){
    const [no, yes] = cur.kind === "practice" ? ["還是忘了", "想起來了"] : ["不記得", "記得"];
    a.append(button("btn", no, () => act("again")), button("btn strong", yes, () => act("good")));
  } else {
    a.classList.add("three");
    a.append(button("btn", "忘了", () => act("again")), button("btn", "想了一下", () => act("hard")),
      button("btn strong", "秒答", () => act("good")),
      (() => { const h = el("div", "grade-hint"); ["想不起來", "慢慢想到", "馬上想到"].forEach(x => h.append(el("span", null, x))); return h; })());
  }
}

function render(animate){
  $("app").dataset.view = view;
  renderTop();
  if (view === "home") renderHome();
  else if (cur) renderCard(animate); else renderDone();
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
        state = pendingImport.state; pendingImport = null; backupMsg = "已匯入進度。"; makeScheduler();
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
  [[c.learning, "學習中"], [c.mastered, "已熟練"], [c.pending, "待確認"], [state.lastDone >= state.day.d - 1 ? state.streak : 0, "連續天數"]].forEach(([v, l]) => {
    const s = el("div", "stat"); s.append(el("b", null, String(v)), el("span", null, l)); st.append(s);
  });
  const S = state.settings;
  seg($("segPerDay"), [[5,"5"],[10,"10"],[15,"15"],[20,"20"]], S.perDay, v => { S.perDay = v; Store.save(); startSession(); });
  seg($("segDeck"), [["all","全部"],["core","生活"],["dev","程式"],["algo","演算法"]], S.deck, v => { S.deck = v; Store.save(); startSession(); });
  seg($("segAuto"), [[true,"開"],[false,"關"]], S.auto, v => { S.auto = v; Store.save(); });
  seg($("segButtons"), [[3,"3 鍵"],[2,"2 鍵"]], S.buttons, v => { S.buttons = v; Store.save(); render(false); });
  /* Takes effect from each word's next review; existing due dates are kept */
  seg($("segRetention"), [[0.85,"85%"],[0.9,"90%"],[0.95,"95%"]], S.retention, v => { S.retention = v; makeScheduler(); Store.save(); });
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
$("backBtn").addEventListener("click", goHome);

/* ---------- input ---------- */
document.addEventListener("pointerdown", () => { interacted = true; }, {capture:true});
document.addEventListener("keydown", e => {
  interacted = true;
  if (!$("sheet").hidden){ if (e.key === "Escape") closeSheet(); return; }
  if (view === "home"){
    if ((e.key === " " || e.key === "Enter") && !(e.target && e.target.tagName === "BUTTON")){
      e.preventDefault(); const b = $("actions").querySelector("button"); if (b) b.click();
    }
    return;
  }
  if (e.key === "Escape"){ goHome(); return; }
  if (!cur) return;
  if (e.target && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
  /* new word: 1/← 我知道了, 2/→ 我要學習. Answer shown: 1/← lowest grade, → highest; with 3 buttons 2 = 想了一下, 3 = 秒答 */
  const three = cur.kind === "review" && state.settings.buttons === 3;
  if (e.key === " " || e.key === "Enter"){ e.preventDefault(); if (cur.kind !== "new" && !revealed) reveal(); }
  else if (e.key === "ArrowLeft" || e.key === "1"){ if (cur.kind === "new") act("know"); else if (revealed) act("again"); }
  else if (e.key === "2"){ if (cur.kind === "new") act("learn"); else if (revealed) act(three ? "hard" : "good"); }
  else if (e.key === "ArrowRight" || (e.key === "3" && three)){ if (cur.kind === "new") act("learn"); else if (revealed) act("good"); }
  else if (e.key.toLowerCase() === "s"){ sayWord(BY_ID[cur.id]); }
});
let rz = 0;
/* Canvases size themselves from layout, so redraw after resizes and once web fonts arrive */
function redrawArt(){ document.querySelectorAll("canvas[data-id]").forEach(cv => drawArt(cv, BY_ID[cv.dataset.id])); if (view === "study" && cur) fitWord(); }
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(redrawArt, 150); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && CARDS.length && todayNum() !== state.day.d) startSession(); });

/* ---------- service worker: offline cache + update prompt ---------- */
function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  /* Reload only after the user accepts an update; the first install also fires controllerchange (clients.claim). */
  let updating = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (updating){ updating = false; location.reload(); } });
  navigator.serviceWorker.register("sw.js").then(reg => {
    const offer = w => {
      $("toast").hidden = false;
      $("toastBtn").onclick = () => { $("toastBtn").disabled = true; updating = true; w.postMessage("skipWaiting"); };
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
    if (!window.FSRS) throw new Error("ts-fsrs not loaded");
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
  makeScheduler();
  startSession();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawArt);
}
boot();
registerSW();
