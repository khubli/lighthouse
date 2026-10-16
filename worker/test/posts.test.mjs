// X and Reddit posts as items. Reddit is answered from recorded shapes of its
// real responses: share links 301 to the post, the JSON API is 403 from
// Cloudflare (switchable here to test the richer path), and oEmbed answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker, setupAccount } from './helpers.mjs';

const POSTS = {
  '1abc23': { sub: 'r/books', author: 'contoso_reader', title: 'Book recommendations?', text: 'Something slow and strange, like a night train that never arrives.' },
  '1abc24': { sub: 'r/suggestmeabook', author: 'fabrikam_fan', title: 'Book recommendations?', text: '' },
};
const SHARES = { SHARE1: '1abc23', SHARE2: '1abc24' };
const permalink = (id) => `https://www.reddit.com/${POSTS[id].sub}/comments/${id}/slug/`;

function reddit({ json = false, deleted = [] } = {}) {
  return async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'www.reddit.com') return new Response('offline in tests', { status: 404 });
    const share = url.pathname.match(/^\/r\/[^/]+\/s\/(\w+)$/);
    if (share && SHARES[share[1]]) {
      return new Response(null, { status: 301, headers: { Location: permalink(SHARES[share[1]]) } });
    }
    const byJson = url.pathname.match(/^\/comments\/(\w+)\.json$/);
    if (byJson) {
      const id = byJson[1];
      if (!json || deleted.includes(id)) return new Response('<html>blocked</html>', { status: 403 });
      const p = POSTS[id];
      return Response.json([{ data: { children: [{ data: {
        title: p.title, selftext: p.text, author: p.author, subreddit_name_prefixed: p.sub,
        score: 1234, num_comments: 56, created_utc: 1759190400,
        permalink: `/${p.sub}/comments/${id}/slug/`,
        preview: { images: [{ source: { url: 'https://preview.redd.it/cover.jpg?width=640' } }] },
      } }] } }]);
    }
    if (url.pathname === '/oembed') {
      const id = (url.searchParams.get('url') || '').match(/comments\/(\w+)/)?.[1];
      if (!id || deleted.includes(id)) return Response.json({ title: '[deleted by user]', author_name: '', html: '' });
      const p = POSTS[id];
      return Response.json({
        title: p.title, author_name: p.author, provider_name: 'reddit', type: 'rich',
        html: `<blockquote class="reddit-embed-bq"><a href="${permalink(id)}">${p.title}</a><br> by <a href="https://www.reddit.com/user/${p.author}/">u/${p.author}</a> in <a href="https://www.reddit.com/${p.sub}/">${p.sub}</a></blockquote>`,
      });
    }
    return new Response('not found', { status: 404 });
  };
}

async function withWorker(outbound, run) {
  const worker = await startWorker({}, { outbound });
  try {
    const cookie = await setupAccount(worker);
    const save = (text, media_type = 'auto') => worker.api('/items', { method: 'POST', cookie, body: { text, media_type } });
    await run({ worker, cookie, save });
  } finally {
    await worker.close();
  }
}

const parse = (item) => ({ ...item, meta: JSON.parse(item.metadata_json), avail: JSON.parse(item.availability_json), ids: JSON.parse(item.external_ids_json) });

test('a Reddit share link saves the post itself, with its subreddit and author', async () => {
  await withWorker(reddit(), async ({ save }) => {
    const res = await save('https://www.reddit.com/r/books/s/SHARE1');
    assert.equal(res.status, 200);
    const item = parse(res.json.item);
    assert.equal(item.media_type, 'post');
    assert.equal(item.title, 'Book recommendations?');
    assert.equal(item.meta.platform, 'reddit');
    assert.equal(item.meta.subreddit, 'r/books');
    assert.equal(item.meta.author_handle, 'contoso_reader');
    assert.equal(item.avail.post_url, permalink('1abc23'));
    assert.equal(item.ids.reddit_post_id, '1abc23');
  });
});

test('when Reddit allows its JSON API, the text, image and votes come too', async () => {
  await withWorker(reddit({ json: true }), async ({ save }) => {
    const item = parse((await save('https://www.reddit.com/r/books/s/SHARE1')).json.item);
    assert.match(item.synopsis, /night train/);
    assert.equal(item.image_url, 'https://preview.redd.it/cover.jpg?width=640');
    assert.equal(item.meta.score, 1234);
    assert.equal(item.meta.comment_count, 56);
    assert.equal(item.release_year, '2025');
  });
});

test('two different posts with the same title stay two items', async () => {
  await withWorker(reddit(), async ({ worker, cookie, save }) => {
    const a = (await save('https://www.reddit.com/r/books/s/SHARE1')).json.item;
    const b = (await save('https://www.reddit.com/r/suggestmeabook/s/SHARE2')).json.item;
    assert.equal(a.title, b.title);
    assert.notEqual(a.id, b.id);
    assert.equal((await worker.api('/items', { cookie })).json.items.length, 2);
    // Renaming one to the other's title is fine: they are still different posts.
    const renamed = await worker.api(`/items/${a.id}`, { method: 'PATCH', cookie, body: { title: 'Book recommendations?' } });
    assert.equal(renamed.status, 200);
  });
});

test('the same post saved by share link and by permalink is one item', async () => {
  await withWorker(reddit(), async ({ save }) => {
    const first = (await save('https://www.reddit.com/r/books/s/SHARE1')).json.item;
    const again = (await save(permalink('1abc23'))).json.item;
    const short = (await save('https://redd.it/1abc23')).json.item;
    assert.equal(again.id, first.id);
    assert.equal(short.id, first.id);
  });
});

test('a deleted Reddit post asks for a note, and saves once there is one', async () => {
  await withWorker(reddit({ deleted: ['1abc23'] }), async ({ save }) => {
    const bare = await save('https://www.reddit.com/r/books/s/SHARE1');
    assert.equal(bare.status, 422);
    assert.equal(bare.json.error, 'source_unavailable');
    assert.match(bare.json.hint, /Reddit post/);
    const noted = await save('https://www.reddit.com/r/books/s/SHARE1 a thread about cosy mysteries');
    assert.equal(noted.status, 200);
    assert.equal(noted.json.item.media_type, 'post');
    assert.equal(noted.json.item.title, 'a thread about cosy mysteries');
  });
});

test('a Reddit link saved as a movie is the movie, not the post', async () => {
  await withWorker(reddit(), async ({ save }) => {
    const res = await save('https://www.reddit.com/r/books/s/SHARE1 Paper Satellites', 'movie');
    assert.equal(res.status, 200);
    assert.equal(res.json.item.media_type, 'movie');
    assert.equal(res.json.item.title, 'Paper Satellites');
  });
});

test('an X post that cannot be fetched still saves when there is a note', async () => {
  await withWorker(undefined, async ({ save }) => {
    const res = await save('https://x.com/someone/status/123456789 great thread on lighthouse lenses');
    assert.equal(res.status, 200);
    assert.equal(res.json.item.media_type, 'post');
  });
});
