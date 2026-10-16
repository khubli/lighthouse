// Cloudflare Access mode. Real RS256 tokens, signed here with keys whose
// public halves the Worker fetches from the "team domain", which the test
// answers through the Worker's outbound stub, the way Cloudflare would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { startWorker, legacyHash } from './helpers.mjs';

const TEAM = 'https://lighthouse-test.cloudflareaccess.com';
const AUD = 'aud-0123456789abcdef';

function makeKey(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}
const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** A token shaped like the one Access adds in Cf-Access-Jwt-Assertion. */
function accessToken(key, claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header })}.${b64url({
    iss: TEAM, aud: [AUD], email: 'me@example.com', type: 'app', sub: 'user-1', iat: now, nbf: now, exp: now + 600, ...claims,
  })}`;
  return `${data}.${sign('sha256', Buffer.from(data), key.privateKey).toString('base64url')}`;
}

const keyA = makeKey('key-a');
const keyB = makeKey('key-b');   // never published: a forger's key
let published = [keyA.jwk];
let certFetches = 0;
let certsUp = true;
const cloudflare = (request) => {
  if (request.url === `${TEAM}/cdn-cgi/access/certs`) {
    certFetches++;
    return certsUp ? Response.json({ keys: published, public_cert: {}, public_certs: [] }) : new Response('down', { status: 503 });
  }
  return new Response('offline in tests', { status: 404 });
};

let worker;
before(async () => {
  worker = await startWorker({ TEAM_DOMAIN: TEAM, POLICY_AUD: AUD }, { outbound: cloudflare });
  // The two existing accounts, as an older install has them: PIN hashes in the
  // pre-PBKDF2 format, no email linked yet.
  for (const [name, pin] of [['alex', '1234'], ['sam', '5678']]) {
    await worker.db.prepare('INSERT INTO users (display_name, pin_hash) VALUES (?, ?)').bind(name, legacyHash('fallback-secret', pin)).run();
  }
});
after(async () => { await worker.close(); });

const as = (token) => ({ 'Cf-Access-Jwt-Assertion': token });
const asEmail = (email) => as(accessToken(keyA, { email }));
const call = (path, { email, token, method = 'GET', body } = {}) =>
  worker.api(path, { method, body, headers: token ? as(token) : email ? asEmail(email) : {} });

test('health reports Access mode', async () => {
  const res = await worker.api('/health');
  assert.equal(res.json.auth.mode, 'cloudflare-access');
});

test('without an Access token nothing but the app files is served', async () => {
  for (const path of ['/dashboard', '/items', '/login', '/share?url=https%3A%2F%2Fx.com', '/pick', '/']) {
    const res = await call(path);
    assert.equal(res.status, 403, path);
    assert.equal(res.json.error, 'access_required', path);
  }
  assert.equal((await call('/manifest.webmanifest')).status, 200);
  assert.equal((await call('/icon-192.png')).status, 200);
});

test('forged, foreign, expired and malformed tokens are refused', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    'signed by an unpublished key': accessToken(keyB, {}, { kid: 'key-a' }),
    'unknown key id': accessToken(keyB),
    'another application': accessToken(keyA, { aud: ['some-other-app'] }),
    'another team': accessToken(keyA, { iss: 'https://evil.cloudflareaccess.com' }),
    'expired': accessToken(keyA, { exp: now - 3600 }),
    'not valid yet': accessToken(keyA, { nbf: now + 3600 }),
    'no email (a service token)': accessToken(keyA, { email: undefined, common_name: 'svc' }),
    'alg none': `${b64url({ alg: 'none', kid: 'key-a' })}.${b64url({ iss: TEAM, aud: [AUD], email: 'me@example.com', exp: now + 600 })}.`,
    'HS256': accessToken(keyA, {}, { alg: 'HS256' }),
    'garbage': 'not.a.token',
    'two parts': 'a.b',
  };
  for (const [label, token] of Object.entries(cases)) {
    assert.equal((await call('/items', { token })).status, 403, label);
  }
});

test('a verified email with no list gets the connect page, and the API says why', async () => {
  const page = await call('/dashboard', { email: 'me@example.com' });
  assert.equal(page.status, 200);
  assert.match(page.text, /Connect your list/);
  assert.match(page.text, /me@example\.com/);
  const items = await call('/items', { email: 'me@example.com' });
  assert.equal(items.status, 401);
  assert.equal(items.json.error, 'not_linked');
});

test('a share made before connecting comes back after it', async () => {
  const res = await call('/share?url=' + encodeURIComponent('https://example.com/film'), { email: 'me@example.com' });
  assert.match(res.text, /data-next="\/dashboard\?prefill=https%3A%2F%2Fexample\.com%2Ffilm"/);
});

test('connecting needs the list\'s real PIN', async () => {
  const wrong = await call('/auth/link', { email: 'me@example.com', method: 'POST', body: { name: 'alex', pin: '0000' } });
  assert.equal(wrong.status, 401);
  assert.equal((await call('/items', { email: 'me@example.com' })).status, 401);
});

test('connecting with the old PIN links the email, and then the email alone opens the list', async () => {
  const linked = await call('/auth/link', { email: 'me@example.com', method: 'POST', body: { name: 'Alex', pin: '1234' } });
  assert.equal(linked.status, 200);
  const row = await worker.db.prepare("SELECT email, pin_hash FROM users WHERE display_name = 'alex'").first();
  assert.equal(row.email, 'me@example.com');
  assert.match(row.pin_hash, /^pbkdf2\$/, 'the old PIN hash is upgraded on the way');

  const dash = await call('/dashboard', { email: 'me@example.com' });
  assert.match(dash.text, /<span class="who">alex<\/span>/);
  assert.equal((await call('/items', { email: 'me@example.com' })).status, 200);
  assert.equal((await call('/items', { email: 'ME@Example.COM' })).status, 200, 'email case does not matter');
});

test('a list already connected to one email cannot be claimed by another', async () => {
  const res = await call('/auth/link', { email: 'someone@example.com', method: 'POST', body: { name: 'alex', pin: '1234' } });
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'already_linked');
});

test('two people, two lists', async () => {
  await call('/auth/link', { email: 'sam@example.com', method: 'POST', body: { name: 'sam', pin: '5678' } });
  const mine = await call('/items', { email: 'me@example.com', method: 'POST', body: { text: 'Paper Satellites', media_type: 'movie' } });
  const theirs = await call('/items', { email: 'sam@example.com', method: 'POST', body: { text: 'Northbound', media_type: 'book' } });
  assert.equal(mine.status, 200);
  assert.equal(theirs.status, 200);
  const myList = (await call('/items', { email: 'me@example.com' })).json.items.map((i) => i.title);
  const theirList = (await call('/items', { email: 'sam@example.com' })).json.items.map((i) => i.title);
  assert.deepEqual(myList, ['Paper Satellites']);
  assert.deepEqual(theirList, ['Northbound']);
  const status = await call(`/items/${theirs.json.item.id}/status`, { email: 'me@example.com', method: 'PATCH', body: { status: 'finished' } });
  assert.equal(status.status, 404, 'my email cannot change her item');
});

test('PIN sign-in steps aside once Access has signed you in', async () => {
  assert.equal((await call('/auth/login', { email: 'me@example.com', method: 'POST', body: { name: 'alex', pin: '1234' } })).status, 409);
  const login = await worker.fetch('/login?next=%2Fdashboard%3Fprefill%3Dx', { headers: asEmail('me@example.com') });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/dashboard?prefill=x');
  const outside = await worker.fetch('/login?next=%2F%2Fevil.example', { headers: asEmail('me@example.com') });
  assert.equal(outside.headers.get('location'), '/dashboard', '//host is not followed');
  const logout = await call('/auth/logout', { email: 'me@example.com', method: 'POST' });
  assert.equal(logout.json.redirect, '/cdn-cgi/access/logout');
});

test('signing keys are cached, and a new key is fetched when Access rotates', async () => {
  const fresh = await startWorker({ TEAM_DOMAIN: 'lighthouse-test.cloudflareaccess.com/', POLICY_AUD: AUD }, { outbound: cloudflare });
  try {
    await fresh.db.prepare("INSERT INTO users (display_name, email) VALUES ('me', 'me@example.com')").run();
    const before = certFetches;
    for (let i = 0; i < 5; i++) assert.equal((await fresh.api('/items', { headers: asEmail('me@example.com') })).status, 200);
    assert.equal(certFetches - before, 1, 'keys fetched once, then cached');

    const keyC = makeKey('key-c');
    published = [keyA.jwk, keyC.jwk];
    assert.equal((await fresh.api('/items', { headers: as(accessToken(keyC)) })).status, 200, 'rotated key accepted');
    assert.equal(certFetches - before, 2);

    // Tokens naming keys that don't exist can't make the Worker hammer Cloudflare.
    for (let i = 0; i < 5; i++) await fresh.api('/items', { headers: as(accessToken(makeKey(`junk-${i}`))) });
    assert.equal(certFetches - before, 2, 'no extra fetches within a minute of the last forced one');
  } finally {
    published = [keyA.jwk];
    await fresh.close();
  }
});

test('if Cloudflare\'s keys can\'t be fetched, nobody gets in', async () => {
  const fresh = await startWorker({ TEAM_DOMAIN: TEAM, POLICY_AUD: AUD }, { outbound: cloudflare });
  certsUp = false;
  try {
    await fresh.db.prepare("INSERT INTO users (display_name, email) VALUES ('me', 'me@example.com')").run();
    assert.equal((await fresh.api('/items', { headers: asEmail('me@example.com') })).status, 403);
  } finally {
    certsUp = true;
    await fresh.close();
  }
});

test('on a brand-new database, the first person creates the first list', async () => {
  const fresh = await startWorker({ TEAM_DOMAIN: TEAM, POLICY_AUD: AUD }, { outbound: cloudflare });
  try {
    const page = await fresh.api('/dashboard', { headers: asEmail('me@example.com') });
    assert.match(page.text, /Create your list/);
    const created = await fresh.api('/setup', { method: 'POST', body: { name: 'me' }, headers: asEmail('me@example.com') });
    assert.equal(created.status, 201);
    assert.equal((await fresh.api('/items', { headers: asEmail('me@example.com') })).status, 200);
    const second = await fresh.api('/setup', { method: 'POST', body: { name: 'x' }, headers: asEmail('other@example.com') });
    assert.equal(second.status, 409, 'only the very first list can be created this way');
  } finally {
    await fresh.close();
  }
});
