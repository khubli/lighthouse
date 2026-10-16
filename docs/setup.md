# Set up Lighthouse

About 15 minutes, once. You end up with:

- your own Lighthouse on Cloudflare's free plan, at `https://lighthouse.<you>.workers.dev` or on a domain of your own;
- a database only your Cloudflare account can read;
- an app on your phone that appears in the share sheet, so a link from any app goes straight into your list.

There is no service in the middle. Lighthouse calls TMDB, your AI provider and the rest with your keys, from your Worker.

## What you need

| | Needed for | Cost |
|---|---|---|
| A Cloudflare account | running the Worker and the D1 database | free plan |
| Node.js 22.18 or later, and git | installing and deploying from your computer | free |
| An AI key *(optional)*: Anthropic, OpenRouter, or any OpenAI-compatible API | turning messy text into a title and a type | your provider's price; OpenRouter has free models |
| A TMDB key *(optional)* | posters, ratings and where to watch for films and series | free |
| A Google key *(optional)* | richer book and YouTube details | free |

Without any keys, Lighthouse still works: built-in rules sort what you save, books come from Open Library, videos from YouTube's public oEmbed, podcasts from gpodder, and X and Reddit posts from their public endpoints. [configuration.md](configuration.md) lists every setting.

## 1. Get the code

```sh
git clone https://github.com/khubli/lighthouse.git
cd lighthouse/worker
npm ci
npx wrangler login        # opens a browser once, to your Cloudflare account
```

## 2. Create your config and database

`wrangler.toml` holds your database id, so it is not in the repository. Copy the template:

```sh
cp wrangler.template.toml wrangler.toml
npm run db:create
```

`db:create` prints a `database_id`. Paste it into `wrangler.toml` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`, then create the tables:

```sh
npm run db:migrate:remote
```

While you have `wrangler.toml` open, set `DEFAULT_REGION` to your country code (`IN`, `US`, `GB`, ...). It decides which streaming services "Where to watch" shows.

## 3. Set the session secret

This is the one setting Lighthouse cannot run without: it signs the cookie that keeps you signed in. Generate a long random value and store it as a Worker secret:

```sh
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
npx wrangler secret put SESSION_SECRET        # paste the value
```

Keep it somewhere safe. Changing it later signs everyone out, which is harmless.

## 4. Deploy

```sh
npm run deploy
```

Wrangler prints your address, for example `https://lighthouse.<you>.workers.dev`. Check it:

```sh
curl https://lighthouse.<you>.workers.dev/health
# {"status":"ok","auth":{"mode":"pin","accessConfigured":false,"sessionSecretConfigured":true,...},"ai":"none"}
```

If `sessionSecretConfigured` is `false`, step 3 did not take effect: run it again and redeploy.

## 5. Create your account

Pick a name and a PIN of 4 to 10 digits:

```sh
npm run users -- add yourname
```

It asks for the PIN without showing it. Open your address, sign in, and you are done.

You can add more people the same way. Each account has its own separate list. To list accounts or change a PIN later:

```sh
npm run users -- list
npm run users -- set-pin yourname
```

<details>
<summary>Without the script: the <code>/setup</code> route</summary>

A brand-new database also accepts one account over HTTP, which is useful when you deploy from CI:

```sh
curl -X POST https://lighthouse.<you>.workers.dev/setup \
  -H "Content-Type: application/json" \
  -d '{"name":"yourname","pin":"123456"}'
```

`/setup` works only while there are no accounts at all. After the first, it answers `409` for good.
</details>

## 6. Put it on your phone

**Android (Chrome):** open your address, sign in, then menu → **Install app**. Lighthouse now appears in the share sheet of every app: share a link from YouTube, X, Reddit, a browser or a podcast app, choose Lighthouse, check the title and press **Save**. An X or Reddit link is preselected as a post. A share made while signed out waits through sign-in.

**iPhone and iPad (Safari):** Share → **Add to Home Screen**. iOS does not let web apps receive shares, so paste links into the box instead.

**Desktop:** the browser's install button in the address bar works too, or just keep it in a tab.

An installed app belongs to its address. If you later move Lighthouse to another address (step 9), install it again from there and delete the old icon; your list is on the server, so nothing is lost.

## 7. Optional: an AI key

Without one, built-in rules sort what you save, and they handle a pasted link or a plain title well. A model does better with messy text like *"that sequel everyone posted about"*, and it notes why you saved something. Set the key for one provider:

| Provider | Secret | Model |
|---|---|---|
| Claude | `npx wrangler secret put ANTHROPIC_API_KEY` ([get a key](https://console.anthropic.com/settings/keys)) | `claude-opus-5-5` unless you set `ANTHROPIC_MODEL`, for example to the cheaper `claude-haiku-5-5` |
| OpenRouter | `npx wrangler secret put OPENROUTER_API_KEY` ([get a key](https://openrouter.ai/keys)) | `OPENROUTER_MODEL` in `wrangler.toml`; free models work |
| Any OpenAI-compatible API | `npx wrangler secret put OPENAI_API_KEY`, plus `OPENAI_BASE_URL` for anything but OpenAI itself | `OPENAI_MODEL` (required) |

`/health` then reports the provider in use, for example `"ai":"anthropic"`, and never the key. If more than one key is set, set `AI_PROVIDER` to the one you want; `AI_PROVIDER = "none"` turns the model off. A model that is slow, down or declines falls back to the built-in rules, so a save never fails because of it. A Claude Pro or Max subscription can't be used here: subscriptions cover Claude's own apps, and Lighthouse runs as a service on your account, so it needs an API key.

The other optional keys, `TMDB_API_KEY` and `GOOGLE_BOOKS_API_KEY`, are set the same way; [configuration.md](configuration.md) says what each adds.

## 8. Recommended: sign in with Cloudflare Access

A 4 to 10 digit PIN is a weak password by any measure. Cloudflare Access, on the free plan, puts a real sign-in in front of every route: each person gets a one-time code by email, and nobody else even sees the app. With Access on, Lighthouse drops PINs altogether and the email Access verified opens that person's list.

1. **Protect the address.** On `workers.dev`: Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings** → **Domains & Routes** → next to the `workers.dev` address, **Enable Cloudflare Access**. On your own domain (step 9): **Zero Trust** → **Access controls** → **Applications** → **Add an application** → **Self-hosted**, with your domain as the application domain.
2. **Allow your people.** In the application's policy: action **Allow**, include **Emails** → each person's email address.
3. **Stay signed in.** Set the application's **Session Duration** to 1 month (and the global one under **Zero Trust** → **Access controls** → **Access settings**), or Access asks for a code every day.
4. **Tell Lighthouse.** The application shows two values: your **team domain** (`https://<team>.cloudflareaccess.com`) and its **Application Audience (AUD) tag**. Store both as secrets:
   ```sh
   npx wrangler secret put TEAM_DOMAIN
   npx wrangler secret put POLICY_AUD
   ```
5. **Link each person's email to their list,** so nobody sees a "Connect your list" page:
   ```sh
   npm run users -- link yourname you@example.com
   ```
   Skip this and each person connects once in the app, with their list's name and PIN.

`/health` (now behind Access, so open it in your browser) shows `"mode":"cloudflare-access"`, and **Sign out** in the app signs you out of Access. To go back to PINs, `npx wrangler secret delete TEAM_DOMAIN`. [SECURITY.md](../SECURITY.md) explains what Lighthouse checks.

## 9. Optional: your own domain

To serve Lighthouse at, say, `lighthouse.example.com` (a domain already on your Cloudflare account), uncomment the `routes` line in `wrangler.toml`, put your address in it, set `workers_dev = false`, and deploy:

```toml
workers_dev = false
preview_urls = false
routes = [{ pattern = "lighthouse.example.com", custom_domain = true }]
```

The deploy creates the address and its certificate; the `workers.dev` address stops answering, so your domain is the only way in. Protect the new address with Access first (step 8), and keep these lines in `wrangler.toml`: a deploy without them switches `workers.dev` back on.

## Updating

```sh
cd lighthouse && git pull
cd worker && npm ci
npm run db:migrate:remote     # applies only new migrations; safe to run every time
npm run deploy
```

Pages are never cached, so the new version shows on the next load, in the browser and in the installed app alike. To deploy from GitHub instead, with your settings in a private repository, see [examples/instance](../examples/instance/README.md).

## If you can't sign in

Work down this list.

1. **`/health` says `sessionSecretConfigured: false`** (PIN mode). Sign-in is switched off until `SESSION_SECRET` is set (step 3). The sign-in page says so too.
2. **"That name and PIN don't match an account."** Names ignore case, PINs do not. Run `npm run users -- list` to see the account names exactly.
3. **Access shows "This Lighthouse opens only through Cloudflare Access".** The request reached the Worker without a valid Access token: check that `TEAM_DOMAIN` and `POLICY_AUD` match the Access application protecting this address (step 8).
4. **Still locked out.** Set a new PIN directly:
   ```sh
   npm run users -- set-pin yourname
   ```
   This uses your Cloudflare login, not the website, so it works whatever state the app is in.
5. **Something else.** `npm run tail` streams the Worker's logs live while you try again.

## Develop locally

```sh
cp .dev.vars.example .dev.vars     # set SESSION_SECRET in it; it is never committed
npm run db:migrate:local
npm run users -- add you --local
npm run dev                        # http://localhost:8787
```

`npm test` runs the whole test suite offline, and `npm run demo` builds the public demo with made-up data into `../_site/`. [CONTRIBUTING.md](../CONTRIBUTING.md) has the rest.
