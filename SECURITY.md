# Security

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's **Report a vulnerability** (Security tab → Advisories) on this repository, with what you found, how to reproduce it, and what an attacker gains. You'll get a reply within a week.

## What Lighthouse is, and what it is not

Lighthouse is a **self-hosted personal app**. The threat model is narrow, and it is worth stating plainly so nobody over-reads the controls below:

- It is meant for one person, or a small group who trust each other, on the operator's own Cloudflare account.
- The data is your own watchlist: titles, notes, statuses. No payment details, no third-party records.
- **PINs are the weak link, by design.** A 4 to 10 digit PIN is a low-entropy credential. PBKDF2 at 100,000 rounds (the most Cloudflare Workers allow) makes each guess cost about 20 ms, which matters, and is not the same as being safe against a determined attacker who has a copy of the database.

## Recommended deployment

**Sign in with Cloudflare Access.** On the free plan, Access stops every request at Cloudflare's edge until the person has signed in with a one-time code sent to an email you allowed, so "someone found the URL and is guessing PINs" stops being possible. Lighthouse then trusts only Access's signed token, checked as below, and uses the verified email to pick the person's list: there are no PINs left to guess. [docs/setup.md](docs/setup.md#8-recommended-sign-in-with-cloudflare-access) has the steps.

If Access is ever removed from in front of the Worker while `TEAM_DOMAIN` is still set, Lighthouse refuses every request rather than falling back to anything weaker.

## Controls in place

| Control | Detail |
|---|---|
| Access tokens | RS256 signature by one of the team's published keys (cached; refetched when a token names an unknown key), issuer equal to `TEAM_DOMAIN`, audience containing `POLICY_AUD`, unexpired. Anything else, including a hand-made header or a token for another Access application, is refused. If the keys can't be fetched, nobody gets in. |
| Email to list | An Access email opens only the list it is linked to (`npm run users -- link`, or once in the app with that list's name and PIN). One email can't be linked to two lists, and a linked list can't be claimed by another email. |
| PIN storage | PBKDF2-SHA256, 100,000 rounds, 16-byte random salt per account. The rounds are stored with each hash, so they can change later without a migration. 100,000 is Cloudflare's ceiling: Workers reject higher counts. |
| Older hashes | PINs from installs before 1.0 used salted SHA-256, salted with the `SESSION_SECRET` of the day. They are checked against the current secret, `LEGACY_PIN_SECRET` if set, and the old built-in default, and rehashed with PBKDF2 on the first successful sign-in. Each still needs the correct PIN. |
| Sessions | HMAC-SHA256-signed token with an expiry, in an `HttpOnly; Secure; SameSite=Lax` cookie lasting 7 days, the same as the token. Only a cookie named exactly `session` is read; a malformed one is treated as signed out. |
| No default secret | Without `SESSION_SECRET`, PIN sign-in is switched off (`503`) and `/health` says so. There is no built-in fallback to sign with. |
| Your keys | AI and provider keys are Worker secrets, sent only to their own provider. `/health` names the AI provider in use, never a key. |
| Name enumeration | An unknown name is checked against a dummy PBKDF2 hash, so it takes as long to reject as a wrong PIN, and gets the same answer. |
| First account | `POST /setup` works only while there are no accounts; `409` for good afterwards. |
| More accounts | `POST /admin/users` needs a session, and can be limited to the names in `ADMIN_USER_NAMES`. `npm run users` works through the operator's Cloudflare login, not the website. |
| Isolation | Every item query is scoped to the signed-in account; another account's item id answers `404`. Merging duplicates never crosses accounts. |
| Input | PIN format, names, statuses and types are checked on the server. All SQL uses bound parameters. A malformed body is a `400`. |
| Redirects | `?next=` after sign-in accepts same-site paths only (`//other-host` is refused). |
| Output | Everything from the database or a provider is escaped before it reaches the page, including in attributes; only `http(s)` links are rendered as links. |
| Caching | The service worker never caches your list or the app page. |

## Out of scope

- **Rate limiting and lockout** on `/auth/login`. Use Cloudflare Access, which removes PIN sign-in, or a WAF rate-limiting rule on that path.
- **CSRF tokens.** Changes are JSON requests with a `SameSite=Lax` cookie, which cross-site forms can't make. A token would be the next step for a wider threat model.
- **Account recovery.** There are no passwords to reset by email. Under Access, the email is the sign-in; otherwise the operator resets a PIN with `npm run users -- set-pin <name>`.

## Supported versions

Fixes go into the latest release on `main`.

## Verifying a change

```sh
cd worker
npm run verify        # typecheck, the test suite, and the docs check
```

The test suite exercises every control above except the timing one, which no test can measure reliably; it holds by construction (the same PBKDF2 work on both paths).
