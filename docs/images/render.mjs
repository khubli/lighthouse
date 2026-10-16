// Renders the README overview (docs/images/how-it-works-{light,dark}.png) and
// the share image (docs/brand/social-preview.png) from their HTML sources.
//
//   node docs/images/render.mjs
//
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install
// chromium), or PLAYWRIGHT_PATH pointing at an installed copy. The images are
// committed, so this is only needed after changing a source.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const browser = await chromium.launch();
async function render(source, out, { width, height, scheme }) {
  const page = await browser.newPage({ viewport: { width, height: height ?? 600 }, deviceScaleFactor: height ? 1 : 1.5, colorScheme: scheme });
  await page.goto(pathToFileURL(resolve(ROOT, source)).href);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: resolve(ROOT, out), fullPage: !height });
  console.log('wrote', out);
}

await render('docs/images/how-it-works.html', 'docs/images/how-it-works-light.png', { width: 1400, scheme: 'light' });
await render('docs/images/how-it-works.html', 'docs/images/how-it-works-dark.png', { width: 1400, scheme: 'dark' });
await render('docs/brand/social-preview.html', 'docs/brand/social-preview.png', { width: 1280, height: 640, scheme: 'dark' });
await browser.close();
