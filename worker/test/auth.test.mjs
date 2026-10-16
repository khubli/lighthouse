import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker, setupAccount, cookieFrom, legacyHash, SECRET } from './helpers.mjs';

let worker;
before(async () => { worker = await startWorker({ LEGACY_PIN_SECRET: 'the-secret-before-rotation' }); });
after(async () => { await worker.close(); });

const login = (name, pin) => worker.api('/auth/login', { method: 'POST', body: { name, pin } });
const addLegacyUser = (name, hash) => worker.db.prepare('INSERT INTO users (display_name, pin_hash) VALUES (?, ?)').bind(name, hash).run();
const storedHash = async (name) => (await worker.db.prepare('SELECT pin_hash FROM users WHERE display_name = ?').bind(name).first()).pin_hash;

test('health names the armed auth controls', async () => {
  const res = await worker.api('/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.auth.sessionSecretConfigured, true);
});

test('setup creates the first account, signs it in, and then closes for good', async () => {
  const first = await worker.api('/setup', { method: 'POST', body: { name: 'alex', pin: '2468' } });
  assert.equal(first.status, 201);
  assert.ok(cookieFrom(first), 'setup should set a session cookie');
  const again = await worker.api('/setup', { method: 'POST', body: { name: 'mallory', pin: '0000' } });
  assert.equal(again.status, 409);
});

test('the right PIN signs in and the cookie opens the dashboard', async () => {
  const res = await login('alex', '2468');
  assert.equal(res.status, 200);
  const cookie = cookieFrom(res);
  assert.match(res.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax; Max-Age=604800/);
  const dash = await worker.fetch('/dashboard', { headers: { Cookie: cookie } });
  assert.equal(dash.status, 200);
  assert.match(await dash.text(), /<title>Lighthouse<\/title>/);
});

test('a wrong PIN and an unknown name get the same answer', async () => {
  const wrong = await login('alex', '1111');
  const unknown = await login('nobody', '2468');
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, unknown.json);
});

test('the name is matched without regard to case, as phones capitalise it', async () => {
  assert.equal((await login('Alex', '2468')).status, 200);
  assert.equal((await login('  ALEX ', '2468')).status, 200);
});

test('bad request bodies are 400s, not 500s', async () => {
  assert.equal((await worker.api('/auth/login', { method: 'POST', body: 'not json' })).status, 400);
  assert.equal((await worker.api('/auth/login', { method: 'POST', body: { name: 5, pin: 2468 } })).status, 400);
  assert.equal((await worker.api('/auth/login', { method: 'POST', body: {} })).status, 400);
});

// The regression: PIN hashes written before PBKDF2 were salted with whatever
// SESSION_SECRET held at the time ("fallback-secret" when it was unset). Once
// the secret changed, every older account was locked out.
test('a legacy hash salted with the old "fallback-secret" still signs in, and is upgraded', async () => {
  await addLegacyUser('fallback-era', legacyHash('fallback-secret', '1357'));
  const res = await login('fallback-era', '1357');
  assert.equal(res.status, 200);
  // 100000 exactly: Cloudflare rejects higher PBKDF2 counts at runtime, and
  // Miniflare does not, so this assertion is the only thing that catches it.
  assert.match(await storedHash('fallback-era'), /^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal((await login('fallback-era', '1357')).status, 200, 'the upgraded hash verifies');
});

test('a legacy hash salted with the current SESSION_SECRET still signs in', async () => {
  await addLegacyUser('same-secret', legacyHash(SECRET, '8642'));
  assert.equal((await login('same-secret', '8642')).status, 200);
});

test('a legacy hash salted with a rotated-away secret signs in via LEGACY_PIN_SECRET', async () => {
  await addLegacyUser('rotated', legacyHash('the-secret-before-rotation', '9753'));
  assert.equal((await login('rotated', '9753')).status, 200);
});

test('a legacy hash still needs the right PIN', async () => {
  await addLegacyUser('legacy-wrong', legacyHash('fallback-secret', '4444'));
  assert.equal((await login('legacy-wrong', '4445')).status, 401);
  assert.equal(await storedHash('legacy-wrong'), legacyHash('fallback-secret', '4444'), 'a failed attempt must not rewrite the hash');
});

test('an old PIN outside today\'s 4-10 digit rule can still sign in', async () => {
  await addLegacyUser('short-pin', legacyHash('fallback-secret', '12'));
  assert.equal((await login('short-pin', '12')).status, 200);
});

test('an account with no PIN cannot sign in with any PIN', async () => {
  await worker.db.prepare('INSERT INTO users (display_name, pin_hash) VALUES (?, NULL)').bind('no-pin').run();
  assert.equal((await login('no-pin', '0000')).status, 401);
});

test('a malformed session cookie is "signed out", not a 500', async () => {
  const res = await worker.fetch('/dashboard', { headers: { Cookie: 'session=a.b.@@@not-base64@@@' } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  assert.equal((await worker.api('/items', { cookie: 'session=x.y.%%%' })).status, 401);
});

test('only a cookie named exactly "session" counts', async () => {
  const cookie = cookieFrom(await login('alex', '2468'));
  const token = cookie.slice('session='.length);
  assert.equal((await worker.api('/items', { cookie: `cf_session=${token}` })).status, 401);
  assert.equal((await worker.api('/items', { cookie: `theme=dark; session=${token}` })).status, 200);
});

test('a session signed with another secret is rejected', async () => {
  const other = await startWorker({ SESSION_SECRET: 'a-completely-different-secret-value' });
  try {
    const foreign = await setupAccount(other, 'alex', '2468');
    assert.equal((await worker.api('/items', { cookie: foreign })).status, 401);
  } finally {
    await other.close();
  }
});

test('/admin/users needs a session, a valid PIN and a new name', async () => {
  const cookie = cookieFrom(await login('alex', '2468'));
  assert.equal((await worker.api('/admin/users', { method: 'POST', body: { name: 'sam', pin: '1234' } })).status, 401);
  assert.equal((await worker.api('/admin/users', { method: 'POST', cookie, body: { name: 'sam', pin: '12' } })).status, 400);
  assert.equal((await worker.api('/admin/users', { method: 'POST', cookie, body: { name: 'sam', pin: '1234' } })).status, 200);
  assert.equal((await worker.api('/admin/users', { method: 'POST', cookie, body: { name: 'SAM', pin: '1234' } })).status, 409);
  assert.equal((await login('sam', '1234')).status, 200);
});

test('ADMIN_USER_NAMES limits who can create accounts', async () => {
  const restricted = await startWorker({ ADMIN_USER_NAMES: 'owner' });
  try {
    const cookie = await setupAccount(restricted, 'guest', '2468');
    const res = await restricted.api('/admin/users', { method: 'POST', cookie, body: { name: 'x', pin: '1234' } });
    assert.equal(res.status, 403);
  } finally {
    await restricted.close();
  }
});

test('without SESSION_SECRET, sign-in is off and says why', async () => {
  const unset = await startWorker({ SESSION_SECRET: undefined });
  try {
    assert.equal((await unset.api('/health')).json.auth.sessionSecretConfigured, false);
    const res = await unset.api('/auth/login', { method: 'POST', body: { name: 'a', pin: '1234' } });
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'session_secret_not_configured');
  } finally {
    await unset.close();
  }
});

test('logout clears the cookie', async () => {
  const res = await worker.api('/auth/logout', { method: 'POST' });
  assert.match(res.headers.get('set-cookie'), /session=;.*Max-Age=0/);
});
