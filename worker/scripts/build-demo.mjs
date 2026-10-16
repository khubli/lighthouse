// Builds the public demo: the real dashboard page, with its API answered in the
// browser from made-up data, so it runs on any static host with no Worker and
// no database.
//
//   node scripts/build-demo.mjs [out-dir]      (default: ../_site)
//
// Nothing is faked in the page itself. dashboardHtml() is the exact function the
// Worker serves; only fetch() is replaced, by a shim that implements the same
// routes (/items, /pick, status, rename, delete) over an in-memory list. Changes
// last until the page is reloaded.
//
// Needs Node 22.18+ (it imports src/dashboard.ts directly, with type stripping).
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardHtml } from '../src/dashboard.ts';
import { demoItems } from './demo-data.mjs';

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? resolve(WORKER, '../_site'));
const REPO = 'https://github.com/khubli/lighthouse';

const items = demoItems();

// The shim runs before the dashboard's own script. It is plain JS in a string,
// so it is kept free of anything the page could misread.
const shim = `<script>
(function () {
  var items = ${JSON.stringify(items)};
  var nextId = 1000;
  var ACTIVE = ["inbox", "interested", "started"];
  function now() { return new Date().toISOString().replace("T", " ").slice(0, 19); }
  function reply(status, body, delay) {
    return new Promise(function (ok) {
      setTimeout(function () {
        ok(new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } }));
      }, delay || 180);
    });
  }
  function find(id) { return items.find(function (i) { return i.id === Number(id); }); }
  function touch(item) { item.updated_at = now(); items.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }); }
  function meta(item) { try { return JSON.parse(item.metadata_json || "{}"); } catch (err) { return {}; } }
  function score(item, short) {
    var m = meta(item);
    var s = ({ started: 6, interested: 5, inbox: 3 })[item.status] || 0;
    var r = Number(m.rating || m.average_rating || 0);
    if (isFinite(r)) s += r / 2;
    if (short) {
      if (item.media_type === "movie" && Number(m.runtime || 999) <= 120) s += 5;
      if (item.media_type === "series" && Number(m.number_of_seasons || 99) <= 1) s += 5;
      if (item.media_type === "book" && Number(m.page_count || 999) <= 250) s += 5;
    }
    return s;
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    var path = url.pathname.replace(/^.*?(\\/(items|pick|stats|auth)(\\/|$))/, "$1");
    var method = (init.method || "GET").toUpperCase();
    var body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch (err) { body = {}; }
    var parts = path.split("/").filter(Boolean);

    if (path === "/items" && method === "GET") return reply(200, { items: items });
    if (path === "/items" && method === "POST") {
      var text = String(body.text || "").trim();
      if (!text) return reply(400, { error: "text_required" });
      var type = body.media_type && body.media_type !== "auto" ? body.media_type : "unknown";
      var title = text.replace(/https?:[^ ]+/g, "").trim() || text;
      var item = { id: nextId++, title: title, media_type: type, status: "inbox", synopsis: null, image_url: null,
        release_year: null, metadata_json: "{}", availability_json: "{}", updated_at: now() };
      items.unshift(item);
      return reply(200, { item: item, extraction: { title: title, media_type: type } }, 900);
    }
    if (parts[0] === "items" && parts[2] === "status" && method === "PATCH") {
      var s = find(parts[1]);
      if (!s) return reply(404, { error: "not_found" });
      s.status = body.status; touch(s);
      return reply(200, { item: s });
    }
    if (parts[0] === "items" && parts[2] === "refresh") {
      var r = find(parts[1]);
      return r ? reply(200, { item: r }, 700) : reply(404, { error: "not_found" });
    }
    if (parts[0] === "items" && parts.length === 2 && method === "PATCH") {
      var p = find(parts[1]);
      if (!p) return reply(404, { error: "not_found" });
      if (body.title) p.title = body.title;
      if (body.media_type) p.media_type = body.media_type;
      touch(p);
      return reply(200, { item: p });
    }
    if (parts[0] === "items" && parts.length === 2 && method === "DELETE") {
      items = items.filter(function (i) { return i.id !== Number(parts[1]); });
      return reply(200, { ok: true });
    }
    if (path === "/pick") {
      var short = url.searchParams.get("mode") === "short";
      var exclude = url.searchParams.get("exclude");
      var pool = items.filter(function (i) { return ACTIVE.indexOf(i.status) !== -1; });
      if (!pool.length) return reply(404, { error: "no_candidates", hint: "Add something to the inbox first." });
      var cands = pool.filter(function (i) { return String(i.id) !== exclude; });
      if (!cands.length) cands = pool;
      cands.sort(function (a, b) { return score(b, short) - score(a, short); });
      var top = score(cands[0], short);
      var tied = cands.filter(function (i) { return score(i, short) === top; });
      return reply(200, { item: tied[Math.floor(Math.random() * tied.length)], mode: short ? "short" : "today", candidates: pool.length });
    }
    if (path === "/auth/logout") return reply(200, { ok: true });
    return realFetch(input, init);
  };
})();
</script>`;

const banner = `<div class="demo-banner" role="note">
  Demo with made-up titles. Changes reset when you reload. Your own Lighthouse is private to you.
  <a href="${REPO}#install-it-yourself">Set up your own &#8599;</a>
</div>
<style>
  .demo-banner { margin: 12px auto 0; max-width: 1180px; width: calc(100% - 32px); padding: 10px 14px; border-radius: 10px;
    background: var(--accent-soft, #fef3c7); color: var(--ink, #1f2937); font-size: 14px; line-height: 1.45; }
  .demo-banner a { color: var(--accent-ink, #92400e); font-weight: 600; }
  /* Signing out has nowhere to go on a static host. */
  #logoutBtn { display: none !important; }
</style>`;

let html = dashboardHtml('Alex');
html = html
  .replace('</head>', `${shim}\n</head>`)
  .replace(/<body([^>]*)>/, (m) => `${m}\n${banner}`)
  // Root-relative URLs would point at the host root, not this folder.
  .replace(/(href|src)="\/(icon-[0-9]+\.png|apple-touch-icon\.png)"/g, '$1="./$2"')
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace('<title>Lighthouse</title>', '<title>Lighthouse demo</title>')
  // No service worker on a static host: there is no /sw.js to register.
  .replace('if ("serviceWorker" in navigator)', 'if (false)');

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'index.html'), html);
for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'icon.svg']) {
  copyFileSync(resolve(WORKER, 'src/assets', icon), resolve(OUT, icon));
}
// Pages serves _underscore paths only without Jekyll.
writeFileSync(resolve(OUT, '.nojekyll'), '');
console.log(`wrote ${OUT}/index.html (${items.length} made-up items, ${Math.round(html.length / 1024)} KB)`);
