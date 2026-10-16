// Made-up watchlist for the public demo, the README screenshots and local
// seeding. Every title, person, channel and post here is invented, and every
// poster is drawn below as SVG, so nothing in the demo is anyone's real artwork
// or anyone's real list.
//
//   import { demoItems } from './demo-data.mjs';

const svg = (w, h, body) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function grad(id, a, b, vertical = true) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
}

function titleBlock(lines, { x = 48, y, size = 64, color = '#fff', font = 'Georgia, serif', weight = 700, anchor = 'start', spacing = 1.08 }) {
  return lines.map((line, i) =>
    `<text x="${x}" y="${y + i * size * spacing}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" letter-spacing="-1">${esc(line)}</text>`,
  ).join('');
}

// --- Poster styles. Each returns a 600x900 (2:3) SVG unless noted. ---

function sunPoster({ lines, sky, sun, ground, kicker }) {
  return svg(600, 900, `<defs>${grad('s', sky[0], sky[1])}</defs>
    <rect width="600" height="900" fill="url(#s)"/>
    <circle cx="300" cy="430" r="150" fill="${sun}" opacity=".92"/>
    <rect y="500" width="600" height="400" fill="${ground}"/>
    <rect y="500" width="600" height="6" fill="${sun}" opacity=".5"/>
    <text x="48" y="80" font-family="Helvetica, Arial, sans-serif" font-size="20" letter-spacing="6" fill="#fff" opacity=".8">${esc(kicker)}</text>
    ${titleBlock(lines, { y: 680, size: 70 })}`);
}

function wavePoster({ lines, sky, sea, kicker }) {
  const waves = [0, 1, 2, 3].map((i) => {
    const y = 470 + i * 70;
    return `<path d="M0 ${y} Q 150 ${y - 40} 300 ${y} T 600 ${y} V 900 H 0 Z" fill="${sea[i % sea.length]}" opacity="${0.55 + i * 0.12}"/>`;
  }).join('');
  return svg(600, 900, `<defs>${grad('s', sky[0], sky[1])}</defs>
    <rect width="600" height="900" fill="url(#s)"/>
    <rect x="404" y="210" width="26" height="150" fill="#f5efe4"/><rect x="398" y="196" width="38" height="20" rx="3" fill="#ffd27a"/>
    <path d="M436 206 L600 160 L600 252 Z" fill="#ffd27a" opacity=".35"/>
    ${waves}
    <text x="48" y="80" font-family="Helvetica, Arial, sans-serif" font-size="20" letter-spacing="6" fill="#fff" opacity=".85">${esc(kicker)}</text>
    ${titleBlock(lines, { y: 760, size: 66 })}`);
}

function gridPoster({ lines, bg, line, glow, kicker }) {
  let rays = '';
  for (let i = -6; i <= 6; i++) rays += `<line x1="300" y1="430" x2="${300 + i * 110}" y2="900" stroke="${line}" stroke-width="2" opacity=".7"/>`;
  for (let i = 0; i < 7; i++) {
    const y = 470 + i * i * 9 + i * 22;
    rays += `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="${line}" stroke-width="2" opacity="${0.25 + i * 0.08}"/>`;
  }
  return svg(600, 900, `<defs>${grad('s', bg[0], bg[1])}<radialGradient id="g" cx=".5" cy=".42" r=".45"><stop offset="0" stop-color="${glow}" stop-opacity=".9"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>
    <rect width="600" height="900" fill="url(#s)"/>
    <rect width="600" height="900" fill="url(#g)"/>
    ${rays}
    <circle cx="300" cy="330" r="64" fill="none" stroke="${glow}" stroke-width="4"/>
    <circle cx="300" cy="330" r="22" fill="${glow}"/>
    <text x="300" y="96" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" letter-spacing="8" fill="#fff" opacity=".8">${esc(kicker)}</text>
    ${titleBlock(lines, { x: 300, y: 170, size: 62, anchor: 'middle', font: 'Helvetica, Arial, sans-serif', weight: 800 })}`);
}

function stripePoster({ lines, bg, stripe, ink, kicker }) {
  let stripes = '';
  for (let i = -10; i < 20; i++) stripes += `<rect x="${i * 60}" y="-200" width="22" height="1400" fill="${stripe}" transform="rotate(28 300 450)"/>`;
  return svg(600, 900, `<rect width="600" height="900" fill="${bg}"/>
    <g opacity=".9">${stripes}</g>
    <rect x="36" y="560" width="528" height="300" fill="${bg}"/>
    <text x="60" y="610" font-family="Helvetica, Arial, sans-serif" font-size="20" letter-spacing="6" fill="${ink}" opacity=".7">${esc(kicker)}</text>
    ${titleBlock(lines, { x: 60, y: 700, size: 68, color: ink, font: 'Helvetica, Arial, sans-serif', weight: 800 })}`);
}

function bookCover({ lines, author, bg, ink, accent, motif = 'circle' }) {
  const art = motif === 'circle'
    ? `<circle cx="300" cy="300" r="120" fill="none" stroke="${accent}" stroke-width="6"/><circle cx="300" cy="300" r="60" fill="${accent}"/>`
    : motif === 'river'
      ? `<path d="M180 120 C 340 220 160 330 320 430 S 260 560 420 600" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round"/>`
      : `<path d="M300 140 L420 420 L180 420 Z" fill="none" stroke="${accent}" stroke-width="8"/><path d="M300 240 L360 420 L240 420 Z" fill="${accent}"/>`;
  return svg(600, 900, `<rect width="600" height="900" fill="${bg}"/>
    <rect x="28" y="28" width="544" height="844" fill="none" stroke="${ink}" stroke-width="2" opacity=".35"/>
    ${art}
    ${titleBlock(lines, { x: 300, y: 610, size: 54, color: ink, anchor: 'middle', spacing: 1.15 })}
    <text x="300" y="830" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="5" fill="${ink}" opacity=".8">${esc(author.toUpperCase())}</text>`);
}

function squareArt({ lines, bg, ink, accent }) {
  let rings = '';
  for (let i = 1; i <= 5; i++) rings += `<circle cx="470" cy="130" r="${i * 46}" fill="none" stroke="${accent}" stroke-width="5" opacity="${1 - i * 0.16}"/>`;
  return svg(600, 600, `<defs>${grad('s', bg[0], bg[1])}</defs>
    <rect width="600" height="600" fill="url(#s)"/>${rings}
    ${titleBlock(lines, { x: 48, y: 430, size: 70, color: ink, font: 'Helvetica, Arial, sans-serif', weight: 800 })}`);
}

function videoThumb({ lines, bg, ink, accent }) {
  return svg(1280, 720, `<defs>${grad('s', bg[0], bg[1], false)}</defs>
    <rect width="1280" height="720" fill="url(#s)"/>
    <circle cx="1010" cy="360" r="190" fill="${accent}" opacity=".25"/>
    <circle cx="1010" cy="360" r="110" fill="${accent}"/>
    <path d="M975 300 L1075 360 L975 420 Z" fill="${bg[0]}"/>
    ${titleBlock(lines, { x: 80, y: 300, size: 104, color: ink, font: 'Helvetica, Arial, sans-serif', weight: 800 })}`);
}

// --- The list. updated_at drives the order, newest first. ---

const providers = (stream, rent = []) => ({
  region: 'GB',
  tmdb_watch_providers: {
    ...(stream.length ? { flatrate: stream.map((provider_name) => ({ provider_name })) } : {}),
    ...(rent.length ? { rent: rent.map((provider_name) => ({ provider_name })) } : {}),
  },
});

const ITEMS = [
  {
    title: 'Paper Satellites', media_type: 'movie', status: 'started', year: '2024',
    synopsis: 'A retired radio engineer and her estranged grandson try to talk to a satellite that went quiet forty years ago, and hear something answer.',
    image: gridPoster({ lines: ['PAPER', 'SATELLITES'], bg: ['#0b1030', '#1e1450'], line: '#6f7cff', glow: '#ffb547', kicker: 'A FILM' }),
    meta: { rating: 8.2, runtime: 141, genres: ['Science Fiction', 'Drama'] },
    avail: providers(['Northlight+'], ['Corner Video']),
    reason: 'Everyone in the group chat said see it in a cinema.',
  },
  {
    title: 'The Long Quiet', media_type: 'movie', status: 'interested', year: '2023',
    synopsis: 'Snowed in at a mountain observatory, two astronomers with nothing in common share one winter, one telescope and one very bad radio.',
    image: sunPoster({ lines: ['The Long', 'Quiet'], sky: ['#f6b66b', '#c2496b'], sun: '#ffe9b0', ground: '#2b1d3a', kicker: 'A FILM' }),
    meta: { rating: 7.8, runtime: 112, genres: ['Drama', 'Romance'] },
    avail: providers(['Harbour TV']),
  },
  {
    title: 'Salt & Static', media_type: 'series', status: 'interested', year: '2025',
    synopsis: 'A pirate radio station on a decommissioned sea fort becomes the only voice a coastal town trusts. One season, eight episodes.',
    image: wavePoster({ lines: ['Salt &', 'Static'], sky: ['#16324f', '#3b6d8f'], sea: ['#0d2236', '#123049', '#18405c', '#1f5170'], kicker: 'LIMITED SERIES' }),
    meta: { rating: 8.4, number_of_seasons: 1, genres: ['Drama', 'Mystery'] },
    avail: providers(['Northlight+']),
  },
  {
    title: 'A Field Guide to Lost Rivers', media_type: 'book', status: 'inbox', year: '2022',
    synopsis: 'Every city is built on rivers it has forgotten. A walking history of the water under our streets, one buried stream at a time.',
    image: bookCover({ lines: ['A Field Guide', 'to Lost Rivers'], author: 'Mara Ellison', bg: '#e9e1cf', ink: '#1f2a37', accent: '#2f6f8f', motif: 'river' }),
    meta: { authors: ['Mara Ellison'], page_count: 212, categories: ['History', 'Nature'], average_rating: 4.3 },
    avail: { info_link: 'https://example.com/books/lost-rivers' },
  },
  {
    title: 'How lighthouse lenses bend light', media_type: 'youtube', status: 'inbox', year: '2025',
    synopsis: 'A Fresnel lens, taken apart prism by prism, and why a lamp the size of a teacup can be seen twenty miles out at sea.',
    image: videoThumb({ lines: ['How the', 'lens works'], bg: ['#0f172a', '#1e3a5f'], ink: '#ffffff', accent: '#fbbf24' }),
    meta: { channel_name: 'Field Notes', duration_seconds: 1122, view_count: 1843000, like_count: 92000, published_at: '2025-08-14T10:00:00Z' },
    avail: { video_url: 'https://www.youtube.com/watch?v=demo0000001', video_id: 'demo0000001' },
  },
  {
    title: 'Slow Signals', media_type: 'podcast', status: 'started', year: null,
    synopsis: 'Long conversations with people who build things that take decades: bridges, forests, dictionaries, cathedrals.',
    image: squareArt({ lines: ['Slow', 'Signals'], bg: ['#2a1b3d', '#5b2a5e'], ink: '#fff4e6', accent: '#ff9e6b' }),
    meta: { publisher: 'Halden Audio' },
    avail: { website: 'https://example.com/slow-signals' },
  },
  {
    title: 'Finished The Long Quiet last night and I have not stopped thinking about the final shot. Watch it with the lights off.', media_type: 'post', status: 'inbox', year: '2025',
    synopsis: 'Finished The Long Quiet last night and I have not stopped thinking about the final shot. Watch it with the lights off, phone in another room. Trust me on this one.',
    image: null,
    meta: { platform: 'x', author_name: 'Kiran Rao', author_handle: 'kiranreads', like_count: 412, view_count: 18300, published_at: 'Mon Sep 29 21:04:00 +0000 2025' },
    avail: { post_url: 'https://x.com/kiranreads/status/1000000000000000001' },
  },
  {
    title: 'Books that feel like a night train that never arrives?', media_type: 'post', status: 'interested', year: '2025',
    synopsis: 'Just finished Northbound and want more like it: quiet, a little uncanny, under 250 pages. What should I read next?',
    image: null,
    meta: { platform: 'reddit', author_handle: 'northwind_reader', subreddit: 'r/slowreads', score: 1840, comment_count: 312, published_at: '2025-10-02T18:20:00.000Z' },
    avail: { post_url: 'https://www.reddit.com/r/slowreads/comments/1abc23/books_that_feel_like_a_night_train/' },
  },
  {
    title: 'The Cartographers', media_type: 'series', status: 'started', year: '2021',
    synopsis: 'Three generations of a mapmaking family argue over the last blank space on the map, and who gets to draw it.',
    image: stripePoster({ lines: ['The', 'Cartographers'], bg: '#f2e8d5', stripe: '#d9a441', ink: '#2c2416', kicker: 'SEASONS 1-3' }),
    meta: { rating: 7.9, number_of_seasons: 3, genres: ['Drama'] },
    avail: providers(['Harbour TV', 'Northlight+']),
  },
  {
    title: 'Northbound', media_type: 'book', status: 'interested', year: '2019',
    synopsis: 'A short, strange novel about a night train that never quite arrives, and the passengers who stop wanting it to.',
    image: bookCover({ lines: ['Northbound'], author: 'T. J. Okafor', bg: '#1d2b3a', ink: '#f3eee2', accent: '#e8a33d', motif: 'peak' }),
    meta: { authors: ['T. J. Okafor'], page_count: 198, categories: ['Fiction'], average_rating: 4.1 },
    avail: { info_link: 'https://example.com/books/northbound' },
  },
  {
    title: 'Harbour Lights', media_type: 'movie', status: 'inbox', year: '2021',
    synopsis: 'A harbour pilot with one week until retirement takes a last ship in through the worst storm in fifty years.',
    image: wavePoster({ lines: ['Harbour', 'Lights'], sky: ['#3a2c4f', '#d27a5a'], sea: ['#1a1830', '#22203d', '#2c2748', '#382f55'], kicker: 'A FILM' }),
    meta: { rating: 7.1, runtime: 98, genres: ['Thriller'] },
    avail: providers([], ['Corner Video']),
  },
  {
    title: 'The Weight of Small Things', media_type: 'book', status: 'inbox', year: '2024',
    synopsis: 'Essays on keeping things: letters, seeds, recipes, a grandfather’s watch, and what we are really holding on to.',
    image: bookCover({ lines: ['The Weight', 'of Small', 'Things'], author: 'Ines Duarte', bg: '#c75b39', ink: '#fff7ee', accent: '#ffd8a8', motif: 'circle' }),
    meta: { authors: ['Ines Duarte'], page_count: 384, categories: ['Essays'], average_rating: 4.5 },
    avail: { info_link: 'https://example.com/books/small-things' },
  },
  {
    title: 'Building a cabin with hand tools', media_type: 'youtube', status: 'interested', year: '2024',
    synopsis: 'Thirty days, one axe, one saw and a lot of rain. The whole build, start to roof.',
    image: videoThumb({ lines: ['30 days.', 'One cabin.'], bg: ['#1f3326', '#3e5b3a'], ink: '#fdf6e3', accent: '#e9c46a' }),
    meta: { channel_name: 'North Studio', duration_seconds: 2754, view_count: 6120000, like_count: 210000, published_at: '2024-11-02T09:00:00Z' },
    avail: { video_url: 'https://www.youtube.com/watch?v=demo0000002', video_id: 'demo0000002' },
  },
  {
    title: 'Low Tide', media_type: 'series', status: 'inbox', year: '2023',
    synopsis: 'When the sea retreats further than it ever has, a fishing village finds a road on the seabed that leads somewhere.',
    image: sunPoster({ lines: ['Low Tide'], sky: ['#9cc7d8', '#e7d4b5'], sun: '#fff6dc', ground: '#4c6b73', kicker: 'SERIES' }),
    meta: { rating: 7.4, number_of_seasons: 2, genres: ['Mystery'] },
    avail: providers(['Harbour TV']),
  },
  {
    title: 'Glasshouse', media_type: 'song', status: 'inbox', year: '2025',
    synopsis: null,
    image: squareArt({ lines: ['Glass', 'house'], bg: ['#0f3d3e', '#1b6b63'], ink: '#e8fff8', accent: '#9be7c4' }),
    meta: { artist: 'Ada Vance', duration_seconds: 247 },
    avail: { video_url: 'https://music.youtube.com/watch?v=demo0000003' },
  },
  {
    title: 'The Margins', media_type: 'podcast', status: 'inbox', year: null,
    synopsis: 'A weekly show about the footnotes of history: the people who were there but did not make the textbook.',
    image: squareArt({ lines: ['The', 'Margins'], bg: ['#f4d35e', '#ee964b'], ink: '#1b1b1e', accent: '#1b1b1e' }),
    meta: { publisher: 'Footnote FM' },
    avail: { website: 'https://example.com/the-margins' },
  },
  {
    title: 'Night Ferry', media_type: 'movie', status: 'finished', year: '2019',
    synopsis: 'Eleven strangers, one overnight crossing, and a passenger who was not on the manifest.',
    image: stripePoster({ lines: ['Night', 'Ferry'], bg: '#101826', stripe: '#24324a', ink: '#f1f5f9', kicker: 'A FILM' }),
    meta: { rating: 7.3, runtime: 105, genres: ['Thriller', 'Mystery'] },
    avail: providers(['Northlight+']),
  },
  {
    title: 'Common Ground', media_type: 'series', status: 'dropped', year: '2022',
    synopsis: 'A comedy about a community garden committee and the four-year war over a single shed.',
    image: sunPoster({ lines: ['Common', 'Ground'], sky: ['#b8e1a8', '#e8f3c8'], sun: '#ffd166', ground: '#5b8a3c', kicker: 'COMEDY SERIES' }),
    meta: { rating: 6.2, number_of_seasons: 4, genres: ['Comedy'] },
    avail: providers(['Harbour TV']),
  },
];

/** Items in the shape GET /items returns, newest first. */
export function demoItems(now = new Date()) {
  return ITEMS.map((item, i) => {
    const updated = new Date(now.getTime() - (i * 7 + 2) * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    return {
      id: 101 + i,
      title: item.title,
      normalized_title: item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      media_type: item.media_type,
      status: item.status,
      synopsis: item.synopsis,
      image_url: item.image,
      release_year: item.year,
      external_ids_json: '{}',
      metadata_json: JSON.stringify(item.meta),
      availability_json: JSON.stringify(item.avail),
      confidence: 0.9,
      created_at: updated,
      updated_at: updated,
      user_id: 1,
    };
  });
}
