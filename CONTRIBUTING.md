# Contributing to Lighthouse

Thanks for helping. Lighthouse is small on purpose: one Worker, one database, one HTML page, no framework and no build step. Changes that keep it that way are the easiest to accept.

## Run it

```sh
cd worker
npm ci
npm test              # offline: the real Worker in Miniflare, an in-memory database, no network
npm run demo          # the demo with made-up titles, built into ../_site; open ../_site/index.html
```

To click around a real instance on your machine:

```sh
cp wrangler.template.toml wrangler.toml     # the database id can stay a placeholder for local work
cp .dev.vars.example .dev.vars              # set SESSION_SECRET in it
npm run db:migrate:local
npm run users -- add you --local
npm run dev                                 # http://localhost:8787
```

Node 22.18 or later. Nothing else to install.

## Where things live

| Path | What |
|---|---|
| `worker/src/index.ts` | The Worker: routes, sign-in, the capture pipeline (read link, classify, enrich, store), picking |
| `worker/src/ai/` | Classification by your AI provider: `anthropic.ts` (Claude), `openai-compatible.ts` (OpenRouter and the rest), the shared `prompt.ts`, and `index.ts`, which picks one |
| `worker/src/access.ts` | Checks Cloudflare Access tokens: signature, issuer, audience, expiry |
| `worker/src/dashboard.ts` | The app: one HTML page with its styles and script |
| `worker/src/login.ts`, `connect.ts` | The sign-in page, and "Connect your list" for Access |
| `worker/src/theme.ts` | Colour tokens, icons and the brand mark, shared by both pages |
| `worker/src/pwa.ts` | **Generated** from `worker/sw.js` and the icons by `scripts/build-pwa.mjs` |
| `worker/migrations/` | The database schema, applied in order |
| `worker/test/` | The test suite (`node --test`) |
| `worker/scripts/users.mjs` | `npm run users`: list, add, set a PIN, directly in D1 |
| `worker/scripts/build-demo.mjs`, `demo-data.mjs` | The static demo and its made-up titles and posters |
| `worker/scripts/verify-docs.mjs` | Checks the docs against the code (links, commands, routes, settings, no secrets) |
| `docs/` | Setup, configuration, how it works, brand, and the HTML the overview and share images are rendered from |
| `action.yml`, `examples/instance/` | The GitHub Action that deploys Lighthouse, and a ready-to-copy private repository that uses it |

## Three rules for the page scripts

The app's and sign-in page's scripts and styles live inside TypeScript template literals. TypeScript sees them as strings, so it can't catch mistakes in them, and each of these has shipped a page whose script never ran:

1. **No backslashes.** The template literal eats them before the browser sees the code: a regex written to match a slash arrives broken, the whole script fails to parse, and a form silently falls back to a native submit. Use character checks (`indexOf`, `charAt`) instead of escaped regexes, and type a character itself (`·`, `“`) instead of an escape for it.
2. **No backticks**, comments included. One closes the template, and `tsc` reports an error far from the real line.
3. **No dollar-brace sequences** in the script. TypeScript interpolates them.

`npm test` parses every emitted script, checks that every element it looks up by id exists in the page, and runs the dashboard script against a stand-in DOM. Run it after any edit to a page.

## Other things that are the way they are on purpose

- **`worker/src/pwa.ts` is generated.** Edit `worker/sw.js` (or the icons), then `node scripts/build-pwa.mjs`. The test suite fails if they are out of step.
- **The service worker never caches data or the app page**, and never calls `skipWaiting()` or `clients.claim()`. Caching data is how an installed app ends up showing yesterday's list as if it were current; claiming the page reloads it mid-typing on the first visit.
- **PINs, not passwords**, with Cloudflare Access as the real gate. See [SECURITY.md](SECURITY.md).
- **No framework, no bundler for the app.** Adding one is a bigger change than it looks; open an issue first.

## Pull requests

- Keep each change focused, with a test that fails without it. `worker/test/helpers.mjs` starts a Worker in a few lines, and can answer the Worker's outbound fetches with whatever a provider would return; `worker/test/posts.test.mjs` and `worker/test/ai.test.mjs` show it with recorded Reddit and AI provider responses.
- `npm run verify` must pass: typecheck, tests, and the docs check.
- If you change what a page looks like, check it at phone width and in both themes (`npm run demo` is the quickest way).
- Never commit a `wrangler.toml`, a `.dev.vars`, a database id, a key, or anyone's real list. Test and demo data use made-up titles.
- Write UI text and messages the way the rest reads: plain, specific, to the reader. [docs/brand](docs/brand/README.md#voice) has examples.

## Questions and ideas

Open an issue. For anything security-related, see [SECURITY.md](SECURITY.md) instead.
