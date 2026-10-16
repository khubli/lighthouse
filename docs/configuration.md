# Configuration

Everything Lighthouse reads from its environment, the commands you run, and the routes it serves.

Secrets are set with `npx wrangler secret put NAME` and live only on the deployed Worker; they survive deploys. Plain settings go under `[vars]` in `wrangler.toml`, and a deploy replaces them with the file's. For local runs, both go in `worker/.dev.vars` (copy [`.dev.vars.example`](../worker/.dev.vars.example)); it is never committed.

## Secrets

| Name | Required | What it does | Without it |
|---|---|---|---|
| `SESSION_SECRET` | **yes** | Signs the session cookie for PIN sign-in. Any long random string. | PIN sign-in is switched off (`503`), and `/health` says so. There is deliberately no built-in default. |
| `ANTHROPIC_API_KEY` | no | AI classification with Claude. [Get a key](https://console.anthropic.com/settings/keys). | Another provider's key, or the built-in rules. |
| `OPENROUTER_API_KEY` | no | AI classification with any model on OpenRouter, free ones included. [Get a key](https://openrouter.ai/keys). | Another provider's key, or the built-in rules. |
| `OPENAI_API_KEY` | no | AI classification with OpenAI, or any OpenAI-compatible API at `OPENAI_BASE_URL`. | Another provider's key, or the built-in rules. A server that needs no key (a local Ollama) works with `OPENAI_BASE_URL` alone. |
| `TMDB_API_KEY` | no | Films and series: poster, synopsis, year, rating, runtime, seasons, genres, and where to watch in `DEFAULT_REGION`. [Get a key](https://www.themoviedb.org/settings/api). | Films and series are saved without details. |
| `GOOGLE_BOOKS_API_KEY` | no | Google Books for books, and the YouTube Data API for duration, views and likes. Enable both APIs on the same Google Cloud key. | Books come from Open Library, videos from YouTube oEmbed. Neither needs a key. |
| `TEAM_DOMAIN` | no | Your Cloudflare Access team domain, `https://<team>.cloudflareaccess.com`. With `POLICY_AUD`, switches sign-in to Cloudflare Access. | PIN sign-in. |
| `POLICY_AUD` | no | The Access application's Audience (AUD) tag. Tokens for any other application are refused. | PIN sign-in. |
| `ADMIN_USER_NAMES` | no | Comma-separated account names allowed to create accounts through `POST /admin/users`. | Any signed-in account can. Fine for one person; set it if you share the Worker. |
| `LEGACY_PIN_SECRET` | no | Only for installs from before 1.0 that changed `SESSION_SECRET` since: the previous value, so PINs set back then can be checked once and rehashed. | Those accounts need `npm run users -- set-pin`. |

The AI keys are your own, used only from your Worker. Set one; if you set several, `AI_PROVIDER` chooses. Whatever the provider, a model that is slow (Claude 20 seconds, others 12), down or declines falls back to the built-in rules, so a save never fails because of it.

## Settings (`[vars]` in `wrangler.toml`)

| Name | Default | What it does |
|---|---|---|
| `DEFAULT_REGION` | `IN` | Country code for "Where to watch" (`US`, `GB`, `DE`, ...). TMDB's availability data is per country. |
| `AI_PROVIDER` | the first key set, in the order Anthropic, OpenRouter, OpenAI-compatible | `anthropic`, `openrouter`, `openai`, or `none` to switch the model off. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Any Claude model, for example `claude-haiku-5-5` to spend less. |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` (the template sets a free model) | Any model your OpenRouter account can use. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Another OpenAI-compatible API: Groq, Together, `http://localhost:11434/v1` for Ollama, ... |
| `OPENAI_MODEL` | none: required for this provider | The model name at that API. |

`wrangler.toml` itself is created from [`wrangler.template.toml`](../worker/wrangler.template.toml) and holds your D1 `database_id`, and your domain if you use one. It is in `.gitignore` because a database id is specific to your account: committing it would point anyone who forks the repository at your database.

## Commands

Run from `worker/`.

| Command | What it does |
|---|---|
| `npm run dev` | The Worker locally on `http://localhost:8787`, against a local database. |
| `npm run deploy` | Publishes the Worker. |
| `npm run tail` | Streams the deployed Worker's logs. |
| `npm run db:create` | Creates the D1 database (once). |
| `npm run db:migrate:remote` | Applies new migrations to the deployed database. Safe to repeat. |
| `npm run db:migrate:local` | The same, for the local database. |
| `npm run db:query "<sql>"` | Runs one SQL statement against the deployed database. |
| `npm run users -- list` | Lists accounts, how each PIN is stored, and the email linked to each. |
| `npm run users -- add <name>` | Creates an account. Asks for the PIN without echoing it. |
| `npm run users -- set-pin <name>` | Sets a new PIN. The way back in if you are locked out. |
| `npm run users -- link <name> <email>` | Cloudflare Access: that email opens that list. |
| `npm run users -- unlink <name>` | Removes the link; the person can connect again from the app. |
| `npm test` | The test suite: offline, about fifteen seconds. |
| `npm run typecheck` | TypeScript, no output when clean. |
| `npm run verify` | Typecheck, tests and the docs check, as CI runs them. |
| `npm run demo` | Builds the public demo into `../_site/`. |

The `users` commands take `--local` to act on the local database instead. They talk to D1 through your Cloudflare login, not through the website, so they work even when nobody can sign in. For scripted use, put the PIN in `LIGHTHOUSE_PIN` rather than on the command line, where it would land in your shell history.

## Routes

"Sign-in" means a valid session cookie in PIN mode, or a verified Access token whose email is linked to a list in Access mode.

| Route | Sign-in | What it does |
|---|---|---|
| `GET /` | | Redirects to `/dashboard`. |
| `GET /dashboard` | yes | The app. Redirects to `/login` when signed out (PIN mode), or shows "Connect your list" for an email not linked yet (Access mode). |
| `GET /login` | | The sign-in page. Honours `?next=` for same-site paths only. |
| `POST /auth/login` | | `{ name, pin }` → session cookie. PIN mode only. |
| `POST /auth/link` | Access | `{ name, pin }` links the verified email to that list, once. Access mode only. |
| `POST /auth/logout` | | Clears the cookie, or points to Access's sign-out. |
| `GET /auth/me` | yes | The signed-in account. |
| `POST /setup` | | Creates the first account (`{ name, pin }`, or `{ name }` under Access) and signs it in. `409` once any account exists. |
| `POST /admin/users` | yes | `{ name, pin }` creates another account. Limited by `ADMIN_USER_NAMES` when set. |
| `GET /share` | | Web Share Target: `?url=`, `?text=`, `?title=` → the app with the box filled in, through sign-in if needed. |
| `GET /items` | yes | Your items, most recently changed first. `?limit=` up to 500. |
| `POST /items` | yes | `{ text, media_type? }`: read the link, classify, enrich, save. `media_type` other than `auto` overrides the classifier. |
| `PATCH /items/:id` | yes | `{ title?, media_type? }`. `409` names the item a rename would collide with. |
| `PATCH /items/:id/status` | yes | `{ status }`: `inbox`, `interested`, `started`, `finished` or `dropped`. |
| `POST /items/:id/refresh` | yes | Runs enrichment again. |
| `DELETE /items/:id` | yes | Removes an item. |
| `GET /pick` | yes | One unfinished item to start now. `?mode=short` prefers short ones; `?exclude=<id>` skips one. |
| `GET /stats` | yes | Counts by type and status. |
| `GET /health` | | `{"status":"ok"}`, the sign-in mode, which settings are configured, and the AI provider by name (never a value). |
| `/manifest.webmanifest`, `/sw.js`, `/icon-*.png`, `/apple-touch-icon.png` | | The installable-app files. They hold no data. |

Every route that needs sign-in answers `401` without one (`403` under Access for a request without a valid Access token). Each account only ever sees its own items: another account's item id answers `404`.

## Data

One D1 (SQLite) database, created by the files in [`worker/migrations/`](../worker/migrations/).

| Table | Holds |
|---|---|
| `users` | Accounts: a name, a PIN hash (`pbkdf2$<rounds>$<salt>$<hash>`), and the email Cloudflare Access signs the person in with, if linked. |
| `raw_captures` | Everything you ever saved, exactly as you typed or shared it, before any processing, with whether processing finished. |
| `items` | The list: one row per title and type per account (one per post, for X and Reddit posts), with details from enrichment. |
| `item_sources` | Which captures led to each item, and why you saved it. |
| `enrichment_runs` | Which provider filled in an item, and when. |
| `personal_signals` | Reserved for notes, mood and priority per item. Created by the schema, not used yet. |

To export everything, `npm run db:query "SELECT * FROM items"` or `npx wrangler d1 export lighthouse-watchlist --remote --output backup.sql`.
