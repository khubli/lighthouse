import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker, setupAccount, cookieFrom } from './helpers.mjs';

let worker;
let alex;
let sam;
before(async () => {
  worker = await startWorker();
  alex = await setupAccount(worker, 'alex', '2468');
  await worker.api('/admin/users', { method: 'POST', cookie: alex, body: { name: 'sam', pin: '1357' } });
  sam = cookieFrom(await worker.api('/auth/login', { method: 'POST', body: { name: 'sam', pin: '1357' } }));
});
after(async () => { await worker.close(); });

const save = (text, media_type = 'auto', cookie = alex) => worker.api('/items', { method: 'POST', cookie, body: { text, media_type } });
const setStatus = (id, status, cookie = alex) => worker.api(`/items/${id}/status`, { method: 'PATCH', cookie, body: { status } });
const setMeta = (id, meta) => worker.db.prepare('UPDATE items SET metadata_json = ? WHERE id = ?').bind(JSON.stringify(meta), id).run();

test('every data route needs a session', async () => {
  for (const [method, path] of [['GET', '/items'], ['POST', '/items'], ['GET', '/pick'], ['GET', '/stats'], ['DELETE', '/items/1']]) {
    assert.equal((await worker.api(path, { method })).status, 401, `${method} ${path}`);
  }
});

test('saving with an explicit type keeps that type, with no network', async () => {
  const res = await save('Paper Satellites', 'movie');
  assert.equal(res.status, 200);
  assert.equal(res.json.item.title, 'Paper Satellites');
  assert.equal(res.json.item.media_type, 'movie');
  assert.equal(res.json.item.status, 'inbox');
});

test('the heuristic classifier runs when no model key is set', async () => {
  const res = await save('read the novel Northbound');
  assert.equal(res.status, 200);
  assert.equal(res.json.item.media_type, 'book');
});

test('saving the same title twice updates one item', async () => {
  const first = await save('The Long Quiet', 'movie');
  const second = await save('the long quiet', 'movie');
  assert.equal(first.json.item.id, second.json.item.id);
});

test('an empty or malformed save is a 400', async () => {
  assert.equal((await save('   ')).status, 400);
  assert.equal((await worker.api('/items', { method: 'POST', cookie: alex, body: 'nope' })).status, 400);
});

test('an X link that cannot be fetched asks for context instead of saving a bare URL', async () => {
  const res = await save('https://x.com/someone/status/123456789');
  assert.equal(res.status, 422);
  assert.equal(res.json.error, 'source_unavailable');
});

test('status, rename and type changes', async () => {
  const id = (await save('Salt and Static', 'series')).json.item.id;
  assert.equal((await setStatus(id, 'interested')).json.item.status, 'interested');
  assert.equal((await setStatus(id, 'binge')).status, 400);
  const renamed = await worker.api(`/items/${id}`, { method: 'PATCH', cookie: alex, body: { title: 'Salt & Static' } });
  assert.equal(renamed.json.item.title, 'Salt & Static');
  const retyped = await worker.api(`/items/${id}`, { method: 'PATCH', cookie: alex, body: { media_type: 'podcast' } });
  assert.equal(retyped.json.item.media_type, 'podcast');
});

test('renaming onto an existing title of the same type is refused, naming the conflict', async () => {
  await save('Harbour Lights', 'movie');
  const other = (await save('Harbor Lights', 'movie')).json.item.id;
  const res = await worker.api(`/items/${other}`, { method: 'PATCH', cookie: alex, body: { title: 'Harbour Lights' } });
  assert.equal(res.status, 409);
  assert.equal(res.json.conflict_title, 'Harbour Lights');
});

test('one account cannot see or touch another\'s items', async () => {
  const id = (await save('Private Thing', 'book')).json.item.id;
  const list = await worker.api('/items', { cookie: sam });
  assert.equal(list.json.items.some((i) => i.id === id), false);
  assert.equal((await setStatus(id, 'finished', sam)).status, 404);
  assert.equal((await worker.api(`/items/${id}`, { method: 'DELETE', cookie: sam })).status, 404);
  assert.equal((await worker.api('/pick', { cookie: sam })).status, 404, 'sam has nothing to pick from');
});

test('the list returns more than the old 100-item cap', async () => {
  const res = await worker.api('/items?limit=500', { cookie: alex });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.items));
  for (let i = 0; i < 105; i++) {
    await worker.db.prepare("INSERT INTO items (title, normalized_title, media_type, user_id) VALUES (?, ?, 'book', 2)")
      .bind(`Filler ${i}`, `filler ${i}`).run();
  }
  const many = await worker.api('/items?limit=500', { cookie: sam });
  assert.equal(many.json.items.length, 105);
});

test('pick only offers unfinished items and honours exclude', async () => {
  const fresh = await startWorker();
  try {
    const cookie = await setupAccount(fresh);
    const post = (text, media_type) => fresh.api('/items', { method: 'POST', cookie, body: { text, media_type } });
    const done = (await post('Night Ferry', 'movie')).json.item.id;
    await fresh.api(`/items/${done}/status`, { method: 'PATCH', cookie, body: { status: 'finished' } });
    const a = (await post('Low Tide', 'series')).json.item.id;
    const b = (await post('Common Ground', 'series')).json.item.id;
    for (let i = 0; i < 10; i++) {
      const res = await fresh.api(`/pick?exclude=${a}`, { cookie });
      assert.equal(res.json.item.id, b);
      assert.equal(res.json.candidates, 2);
    }
    // Excluding the only candidate falls back to it rather than to nothing.
    await fresh.api(`/items/${b}/status`, { method: 'PATCH', cookie, body: { status: 'dropped' } });
    assert.equal((await fresh.api(`/pick?exclude=${a}`, { cookie })).json.item.id, a);
  } finally {
    await fresh.close();
  }
});

test('short pick prefers the low-commitment item', async () => {
  const fresh = await startWorker();
  try {
    const cookie = await setupAccount(fresh);
    const post = (text, media_type) => fresh.api('/items', { method: 'POST', cookie, body: { text, media_type } });
    const long = (await post('A Very Long Film', 'movie')).json.item.id;
    const short = (await post('A Short Film', 'movie')).json.item.id;
    await fresh.db.prepare('UPDATE items SET metadata_json = ? WHERE id = ?').bind(JSON.stringify({ runtime: 190, rating: 8 }), long).run();
    await fresh.db.prepare('UPDATE items SET metadata_json = ? WHERE id = ?').bind(JSON.stringify({ runtime: 95, rating: 7 }), short).run();
    assert.equal((await fresh.api('/pick?mode=short', { cookie })).json.item.id, short);
    assert.equal((await fresh.api('/pick?mode=today', { cookie })).json.item.id, long);
  } finally {
    await fresh.close();
  }
});

test('delete removes the item and then reports it gone', async () => {
  const id = (await save('Glasshouse', 'song')).json.item.id;
  assert.equal((await worker.api(`/items/${id}`, { method: 'DELETE', cookie: alex })).status, 200);
  assert.equal((await worker.api(`/items/${id}`, { method: 'DELETE', cookie: alex })).status, 404);
});

test('refresh with every provider down says there is nothing new', async () => {
  const id = (await save('The Margins', 'podcast')).json.item.id;
  const res = await worker.api(`/items/${id}/refresh`, { method: 'POST', cookie: alex });
  assert.equal(res.status, 404);
  assert.equal(res.json.error, 'no_new_data');
});

test('stats counts by type and status for the signed-in account only', async () => {
  const res = await worker.api('/stats', { cookie: alex });
  assert.equal(res.status, 200);
  assert.ok(res.json.items_by_type.movie >= 1);
  assert.equal(res.json.items_by_type.book >= 1, true);
});

test('the share target carries a shared link through sign-in', async () => {
  const res = await worker.fetch('/share?url=' + encodeURIComponent('https://example.com/film'));
  assert.equal(res.status, 302);
  const next = new URL(res.headers.get('location'), 'https://x').searchParams.get('next');
  assert.equal(next, '/dashboard?prefill=https%3A%2F%2Fexample.com%2Ffilm');
  const signedIn = await worker.fetch('/share?text=hello', { headers: { Cookie: alex } });
  assert.equal(signedIn.headers.get('location'), '/dashboard?prefill=hello');
});

// Enrichment can rename an item to a title its owner already has. That used to
// fail with a 500 for books (whose provider sets no media_type), and the merge
// it should trigger was not scoped to the owner, so it could swallow another
// account's item.
test('enrichment onto an existing title merges within one account only', async () => {
  const openLibrary = (request) => {
    if (!request.url.startsWith('https://openlibrary.org/')) return new Response('offline', { status: 404 });
    return Response.json({ docs: [{ key: '/works/OL1W', title: 'The Shared Title', author_name: ['A. Writer'], number_of_pages_median: 180 }] });
  };
  const w = await startWorker({}, { outbound: openLibrary });
  try {
    const a = await setupAccount(w, 'a', '2468');
    await w.api('/admin/users', { method: 'POST', cookie: a, body: { name: 'b', pin: '1357' } });
    const b = cookieFrom(await w.api('/auth/login', { method: 'POST', body: { name: 'b', pin: '1357' } }));
    const saveAs = (cookie, text) => w.api('/items', { method: 'POST', cookie, body: { text, media_type: 'book' } });

    const first = await saveAs(a, 'first thing');
    assert.equal(first.status, 200);
    assert.equal(first.json.item.title, 'The Shared Title');

    const other = await saveAs(b, 'something else');
    assert.equal(other.status, 200, 'another account enriching to the same title');
    assert.notEqual(other.json.item.id, first.json.item.id, 'must not be merged into another account\'s item');
    assert.equal((await w.api('/items', { cookie: b })).json.items.length, 1);

    const again = await saveAs(a, 'second thing');
    assert.equal(again.status, 200, 'enriching onto an existing title of the same account is not a 500');
    assert.equal(again.json.item.id, first.json.item.id, 'the response names the surviving item');
    assert.equal((await w.api('/items', { cookie: a })).json.items.length, 1);
  } finally {
    await w.close();
  }
});
