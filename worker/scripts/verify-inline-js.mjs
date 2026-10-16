// Parses every inline <script> the Worker actually emits, for every HTML surface.
//
// This exists because a template-literal escape bug in the login page shipped
// unnoticed: the emitted JS failed to parse, which killed the whole script and
// silently downgraded the login form to a native GET. Nothing in the typecheck
// sees a string. Run this after ANY edit to a page's inline script.
//
//   node scripts/verify-inline-js.mjs [baseUrl]
//
// npm test runs the same checks in-process, with no server to start; this
// script is for checking a running or deployed Worker.
import vm from 'node:vm';

const BASE = process.argv[2] || 'http://localhost:8799';

// Surfaces with inline scripts. /login and /dashboard are the two that exist;
// the dashboard requires a session, so an unauthenticated fetch is expected to
// 302 there and is reported rather than failed.
const PAGES = [
  { path: '/login', expect: 'ok' },
  { path: '/dashboard', expect: 'redirect-or-ok' },
  { path: '/', expect: 'redirect-or-ok' },
];

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS  ' + label + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + label + (extra ? ' — ' + extra : '')); }
};

for (const page of PAGES) {
  console.log(`\n${page.path}`);
  const res = await fetch(BASE + page.path, { redirect: 'manual' });
  const ctype = res.headers.get('content-type') || '';

  if (!ctype.includes('text/html')) {
    const ok = page.expect === 'redirect-or-ok' ? res.status < 400 : false;
    check('no HTML to check', ok, `status ${res.status} ${ctype}`);
    continue;
  }

  const html = await res.text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  check('inline script found', scripts.length > 0, `${scripts.length} block(s)`);

  for (const [i, js] of scripts.entries()) {
    try {
      new vm.Script(js);
      check(`script #${i + 1} parses`, true, `${js.length} bytes`);
    } catch (e) {
      check(`script #${i + 1} parses`, false, e.message);
      const line = (e.stack || '').match(/_login\S*:(\d+)/) || (e.stack || '').match(/:(\d+)/);
      if (line) {
        const n = Number(line[1]);
        console.log('       offending line: ' + String(js.split('\n')[n - 1] || '').trim().slice(0, 160));
      }
    }

    // Backticks surviving into emitted JS mean an interpolation boundary was
    // crossed somewhere. Harmless in a nested template, but worth seeing.
    const ticks = (js.match(/`/g) || []).length;
    if (ticks % 2 !== 0) check('backticks balanced', false, `${ticks} backtick(s)`);

    // Every getElementById target should exist in the same document, otherwise
    // a listener silently never attaches — the exact failure mode of the bug
    // above, one level up.
    const ids = [...js.matchAll(/(?:getElementById|byId)\("([^"]+)"\)/g)].map(m => m[1]);
    const missing = ids.filter(id => !html.includes(`id="${id}"`));
    check('all getElementById targets exist in the HTML', missing.length === 0,
      missing.length ? 'missing: ' + missing.join(', ') : `${ids.length} id(s)`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
