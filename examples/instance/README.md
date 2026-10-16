# My Lighthouse

My settings for [Lighthouse](https://github.com/khubli/lighthouse), and a button that deploys it to my Cloudflare account. Keep this repository **private**: `wrangler.toml` holds my database id.

My list itself is not here. It lives in my Cloudflare D1 database, and only my Cloudflare account can read it.

| File | What it is |
|---|---|
| `wrangler.toml` | My settings: database id, region, AI model, and my domain if I use one |
| `.github/workflows/deploy.yml` | Deploys Lighthouse (`khubli/lighthouse@v1`) with those settings |

## Set it up (about 10 minutes)

This assumes the database and secrets already exist, from [docs/setup.md](../../docs/setup.md) steps 2 and 3, or that you create them now.

1. **Make the repository.** On GitHub, **New repository**, **Private**, and copy this folder's files into it (`wrangler.toml` and `.github/workflows/deploy.yml`).
2. **Fill in `wrangler.toml`.** Paste your D1 `database_id`, set `DEFAULT_REGION`, and, for your own domain, uncomment `routes` and set `workers_dev = false` ([setup step 9](../../docs/setup.md#9-optional-your-own-domain)).
3. **Make a Cloudflare token.** Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token** → the **Edit Cloudflare Workers** template. Add the permission **Account** → **D1** → **Edit**, limit **Account resources** to your account and **Zone resources** to your domain, and create it.
4. **Give it to GitHub.** In this repository, **Settings** → **Secrets and variables** → **Actions** → **New repository secret**: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (shown on the right of **Workers & Pages** → **Overview**). Optionally, under **Variables**, `LIGHTHOUSE_URL` with your address, so each run checks that a stranger is asked to sign in.
5. **Deploy.** **Actions** → **Deploy** → **Run workflow**. It applies any new database migrations, deploys, and checks the address.

Secrets the Worker uses (`SESSION_SECRET`, your AI key, `TEAM_DOMAIN`, `POLICY_AUD`...) are not part of this repository and a deploy never touches them. Set or change them with `npx wrangler secret put NAME`, or in the Cloudflare dashboard: your Worker → **Settings** → **Variables and Secrets**. [docs/configuration.md](../../docs/configuration.md) lists them all.

## Updating

`@v1` always means the latest 1.x release of Lighthouse. Run **Deploy** again to pick it up; nothing in this repository changes.
