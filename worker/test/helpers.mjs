// Runs the real Worker in-process for tests: src/index.ts bundled with esbuild,
// served by Miniflare (the same workerd runtime `wrangler dev` uses), with an
// in-memory D1 database migrated from migrations/*.sql.
//
// Offline by construction: every outbound fetch (TMDB, OpenRouter, FxTwitter,
// Open Library...) is answered with a 404, so enrichment degrades exactly as it
// does when a provider is down, and no test depends on the network.
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SECRET = 'test-session-secret-0123456789abcdef';

let bundled;
async function bundle() {
  if (!bundled) {
    const out = await build({
      entryPoints: [resolve(WORKER, 'src/index.ts')],
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent',
    });
    bundled = out.outputFiles[0].text;
  }
  return bundled;
}

function migrationStatements() {
  const dir = resolve(WORKER, 'migrations');
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().flatMap((file) => {
    const sql = readFileSync(resolve(dir, file), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    return sql.split(';').map((s) => s.trim()).filter(Boolean);
  });
}

/**
 * Starts a Worker. `vars` replaces the default bindings (pass SESSION_SECRET:
 * undefined to unset it). `outbound` answers the Worker's own fetches, for
 * tests that need a provider to return something; the default is a 404.
 */
export async function startWorker(vars = {}, { outbound } = {}) {
  const bindings = Object.fromEntries(
    Object.entries({ SESSION_SECRET: SECRET, ...vars }).filter(([, v]) => v !== undefined),
  );
  const mf = new Miniflare({
    modules: true,
    script: await bundle(),
    compatibilityDate: '2026-06-30',
    d1Databases: { DB: 'lighthouse-test' },
    bindings,
    outboundService: outbound ?? (() => new Response('offline in tests', { status: 404 })),
  });
  const db = await mf.getD1Database('DB');
  for (const statement of migrationStatements()) await db.prepare(statement).run();

  const fetchRaw = (path, init = {}) => mf.dispatchFetch('https://lighthouse.test' + path, { redirect: 'manual', ...init });
  const api = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const res = await fetchRaw(path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { mf, db, fetch: fetchRaw, api, close: () => mf.dispose() };
}

/** The session cookie a response set, as a Cookie header value. */
export function cookieFrom(res) {
  const set = res.headers.get('set-cookie') || '';
  const match = set.match(/session=([^;]+)/);
  return match ? `session=${match[1]}` : null;
}

/** Creates the first account via /setup and returns its cookie. */
export async function setupAccount(worker, name = 'alex', pin = '2468') {
  const res = await worker.api('/setup', { method: 'POST', body: { name, pin } });
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${res.text}`);
  return cookieFrom(res);
}

/** The hash the pre-PBKDF2 Worker stored: SHA-256 over `${secret}:${pin}`. */
export function legacyHash(secret, pin) {
  return createHash('sha256').update(`${secret}:${pin}`).digest('hex');
}

/** Every inline script in an HTML document. */
export function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}
