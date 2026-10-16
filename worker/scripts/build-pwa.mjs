// Emits worker/src/pwa.ts from a readable source file.
//
// The SW source cannot be a TS template literal: it contains backticks and
// ${} that would be interpolated by TypeScript before the browser ever sees them.
// It must be a plain string, which makes it unreadable and easy to corrupt by
// hand. Keeping the real source in sw.js and generating the module from it means
// the Worker ships the same text that is lintable and testable on disk.
//
//   node scripts/build-pwa.mjs
//
// Run after every change to worker/sw.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SW = resolve(WORKER, 'sw.js');
const OUT = resolve(WORKER, 'src/pwa.ts');
const ASSETS = resolve(WORKER, 'src/assets');

const sw = readFileSync(SW, 'utf8').trimEnd();

// Sanity checks: these have all shipped broken at some point.
if (sw.includes('`')) throw new Error('sw.js contains a backtick; the string encoding below would break');
if (!sw.includes('self.addEventListener')) throw new Error('sw.js has no listeners; refusing to emit');

const readIcon = (name) => readFileSync(resolve(ASSETS, name)).toString('base64');

const ts = `// GENERATED FILE - do not edit by hand.
//
// Source: worker/sw.js  (plus the PNG icons under worker/src/assets/)
// Regenerate:  node scripts/build-pwa.mjs
//
// Everything below is plain strings, not template literals, on purpose. The
// service worker source contains backticks and \${} sequences; inside a TS
// template literal TypeScript would interpolate them before the browser saw
// them. Hand-editing the escaped SW string is how that breakage happens, which
// is why the readable source lives in its own file.

export const MANIFEST_JSON = ${JSON.stringify({
  name: 'Lighthouse',
  short_name: 'Lighthouse',
  description: 'Your watchlist for films, series, books, podcasts and videos',
  start_url: '/dashboard',
  display: 'standalone',
  background_color: '#0d1017',
  theme_color: '#0d1017',
  orientation: 'portrait',
  // Web Share Target: makes Lighthouse appear in Android Chrome's share sheet
  // when sharing a link out of another app. Uses GET so the shared payload
  // arrives as query params and /share can redirect into the dashboard.
  share_target: {
    action: '/share',
    method: 'GET',
    enctype: 'application/x-www-form-urlencoded',
    params: { title: 'title', text: 'text', url: 'url' },
  },
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // Full-bleed, with the mark inside the safe zone. Android crops maskable
    // icons to its own shape; the rounded icon above lost its corners to that.
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2)};

export const SERVICE_WORKER_JS = ${JSON.stringify(sw)};

export const ICON_192 = { data: 'data:image/png;base64,${readIcon('icon-192.png')}', contentType: 'image/png' };
export const ICON_512 = { data: 'data:image/png;base64,${readIcon('icon-512.png')}', contentType: 'image/png' };
export const APPLE_TOUCH_ICON = { data: 'data:image/png;base64,${readIcon('apple-touch-icon.png')}', contentType: 'image/png' };
export const ICON_MASKABLE = { data: 'data:image/png;base64,${readIcon('icon-maskable-512.png')}', contentType: 'image/png' };
`;

writeFileSync(OUT, ts, 'utf8');
console.log(`wrote src/pwa.ts (${ts.length} bytes) from sw.js (${sw.length} bytes)`);
