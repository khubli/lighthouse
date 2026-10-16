// The page scripts live in TS template literals, so tsc never sees them: a
// broken escape compiles cleanly and ships a page whose script never runs.
// These tests parse every inline script the Worker emits, check that every
// element the script looks up exists, and run the dashboard script against a
// stand-in DOM to catch errors at load time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startWorker, setupAccount, inlineScripts, WORKER } from './helpers.mjs';
import { demoItems } from '../scripts/demo-data.mjs';

let worker;
let pages;
before(async () => {
  worker = await startWorker();
  const cookie = await setupAccount(worker);
  pages = {
    '/login': await (await worker.fetch('/login')).text(),
    '/dashboard': await (await worker.fetch('/dashboard', { headers: { Cookie: cookie } })).text(),
  };
});
after(async () => { await worker.close(); });

for (const path of ['/login', '/dashboard']) {
  test(`${path}: every inline script parses`, () => {
    const scripts = inlineScripts(pages[path]);
    assert.ok(scripts.length >= 2, 'expected the theme script and the page script');
    for (const [i, js] of scripts.entries()) {
      assert.doesNotThrow(() => new vm.Script(js), `script #${i + 1} does not parse`);
    }
  });

  test(`${path}: every element the script looks up exists in the page`, () => {
    const html = pages[path];
    const ids = new Set();
    for (const js of inlineScripts(html)) {
      for (const m of js.matchAll(/(?:getElementById|byId)\("([^"]+)"\)/g)) ids.add(m[1]);
    }
    const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
    assert.deepEqual(missing, []);
  });

  test(`${path}: no template-literal debris reached the browser`, () => {
    const html = pages[path];
    assert.ok(!html.includes('${'), 'an unreplaced ${...} survived');
    assert.ok(!/undefined<|>undefined/.test(html), 'an interpolation produced "undefined"');
  });
}

test('the account name is escaped into the dashboard', async () => {
  const other = await startWorker();
  try {
    const cookie = await setupAccount(other, '<img src=x onerror=alert(1)>', '2468');
    const html = await (await other.fetch('/dashboard', { headers: { Cookie: cookie } })).text();
    assert.ok(!html.includes('<img src=x'), 'raw markup from the name reached the page');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  } finally {
    await other.close();
  }
});

// A stand-in DOM. getElementById returns null for an id that is not in the
// page, exactly like a browser, so a lookup of a missing element throws here
// the way it would in production. Everything else is a permissive stub.
function stub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      if (prop === 'length') return 0;
      if (prop === 'options') return [];
      if (prop === 'value' || prop === 'textContent' || prop === 'innerHTML') return '';
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
  });
  return proxy;
}

function runDashboardScript(html, items) {
  const script = inlineScripts(html).find((js) => js.includes('function loadItems'));
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!html.includes(`id="${id}"`)) return null;
      if (!elements.has(id)) elements.set(id, stub());
      return elements.get(id);
    },
    addEventListener() {},
    documentElement: stub(),
    createElement: () => stub(),
  };
  const errors = [];
  const context = vm.createContext({
    document,
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    navigator: {},
    location: { pathname: '/dashboard', search: '', href: '' },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
    URLSearchParams, URL, Intl, JSON, Math, Date, Number, String, Array, Object, Promise, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ items }) }),
    console: { error: (e) => errors.push(e) },
  });
  vm.runInContext(script, context, { filename: 'dashboard-inline.js' });
  return { context, errors };
}

test('the dashboard script runs to the end against the real page and loads the list', async () => {
  const items = demoItems();
  const { context } = runDashboardScript(pages['/dashboard'], items);
  // loadItems() is called last; give its promise a turn to settle.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(vm.runInContext('state.items.length', context), items.length);
});

test('dashboard helpers: escaping and link safety', () => {
  const { context } = runDashboardScript(pages['/dashboard'], []);
  const run = (code) => vm.runInContext(code, context);
  assert.equal(run('esc(\'"><img onerror=x>\')'), '&quot;&gt;&lt;img onerror=x&gt;');
  assert.equal(run('safeUrl("javascript:alert(1)")'), '');
  assert.equal(run('safeUrl("JavaScript:alert(1)")'), '');
  assert.equal(run('safeUrl("https://example.com/a")'), 'https://example.com/a');
  assert.equal(run('safeImg("data:image/svg+xml,abc")'), 'data:image/svg+xml,abc');
  assert.equal(run('safeImg("data:text/html,abc")'), '');
});

test('dashboard helpers: the line under each card', () => {
  const { context } = runDashboardScript(pages['/dashboard'], []);
  const line = (item) => vm.runInContext(`metaLine(${JSON.stringify(item)})`, context);
  const item = (media_type, meta, release_year = null) => ({ media_type, release_year, metadata_json: JSON.stringify(meta) });
  assert.equal(line(item('movie', { runtime: 141 }, '2024')), 'Movie · 2024 · 2h 21m');
  assert.equal(line(item('series', { number_of_seasons: 1 }, '2025')), 'Series · 2025 · 1 season');
  assert.equal(line(item('book', { authors: ['Mara Ellison'], page_count: 212 })), 'Book · Mara Ellison · 212 pages');
  assert.equal(line(item('youtube', { channel_name: 'Field Notes', duration_seconds: 3725 })), 'Video · Field Notes · 1:02:05');
  assert.equal(line(item('mystery', {})), 'Other');
});

test('/login: the ?next= guard keeps redirects on this site', () => {
  const script = inlineScripts(pages['/login']).find((js) => js.includes('isSafeNext'));
  const context = vm.createContext({
    document: { getElementById: () => ({ addEventListener() {} }) },
    navigator: {}, window: { addEventListener() {} }, location: {}, URLSearchParams,
  });
  vm.runInContext(script, context);
  const safe = (v) => vm.runInContext(`isSafeNext(${JSON.stringify(v)})`, context);
  assert.equal(safe('/dashboard?prefill=https%3A%2F%2Fx.com%2Fa'), true);
  assert.equal(safe('//evil.example/path'), false, 'protocol-relative URL leaves the site');
  assert.equal(safe('https://evil.example'), false);
  assert.equal(safe('/'), false);
  assert.equal(safe(null), false);
});

test('service worker source parses and keeps data routes off the cache', () => {
  const sw = readFileSync(resolve(WORKER, 'sw.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(sw));
  for (const route of ["'/items'", "'/auth'", "'/pick'", "'/dashboard'"]) assert.ok(sw.includes(route), route);
  const code = sw.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!code.includes('skipWaiting('), 'skipWaiting reloads a half-typed sign-in form');
  assert.ok(!code.includes('clients.claim('), 'claiming the page forces a reload on first visit');
});

test('the generated pwa.ts matches sw.js', async () => {
  const { SERVICE_WORKER_JS } = await import('../src/pwa.ts');
  assert.equal(SERVICE_WORKER_JS, readFileSync(resolve(WORKER, 'sw.js'), 'utf8').trimEnd(), 'run node scripts/build-pwa.mjs');
});

test('manifest declares the share target', async () => {
  const res = await worker.fetch('/manifest.webmanifest');
  const manifest = await res.json();
  assert.equal(manifest.share_target.action, '/share');
  assert.equal(res.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
});
