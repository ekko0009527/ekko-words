/* Service worker: precache the app and every audio clip at install, serve cache-first.
   VERSION is rewritten by tools/stamp_sw.py from a hash of the cached files, so any
   content change produces a new cache and the page shows an "update" prompt. */
const VERSION = "8d9398619fe5";
const CACHE = "ekko-words-" + VERSION;
const FONT_CACHE = "ekko-fonts";
const SHELL = [
  "./", "index.html", "css/style.css", "js/app.js", "words.json", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, {cache: "reload"})));
    const words = await (await cache.match("words.json")).json();
    const clips = words.flatMap(w => ["audio/" + w.id + ".mp3", "audio/" + w.id + "-ex.mp3"]);
    await cache.addAll(clips.map(u => new Request(u, {cache: "reload"})));
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("ekko-words-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

/* <audio> sends Range requests; Safari only plays them from a 206 response. */
async function rangeResponse(req, res){
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (!m) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : size - 1;
  start = Math.max(0, start); end = Math.min(end, size - 1);
  if (start > end) return new Response(null, {status: 416, headers: {"Content-Range": `bytes */${size}`}});
  return new Response(buf.slice(start, end + 1), {status: 206, headers: {
    "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes"
  }});
}

async function fromCache(req){
  const cache = await caches.open(CACHE);
  const key = req.mode === "navigate" ? "index.html" : req;
  const hit = await cache.match(key, {ignoreSearch: true});
  if (hit) return req.headers.has("range") ? rangeResponse(req, hit) : hit;
  return fetch(req);
}

/* Google Fonts: stale-while-revalidate; offline without a cached copy falls back to system fonts. */
async function fromFontCache(e){
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(e.request);
  const net = fetch(e.request).then(res => {
    if (res.ok || res.type === "opaque") cache.put(e.request, res.clone());
    return res;
  }).catch(() => hit || Response.error());
  if (hit){ e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(fromCache(req));
  else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") e.respondWith(fromFontCache(e));
});
