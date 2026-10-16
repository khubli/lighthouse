export interface Env extends AiEnv {
  DB: D1Database;
  TMDB_API_KEY?: string;
  GOOGLE_BOOKS_API_KEY?: string;
  DEFAULT_REGION?: string;
  SESSION_SECRET?: string;
  // The SESSION_SECRET value from before it was rotated, if it ever was. Only
  // used to verify PIN hashes written by the pre-PBKDF2 scheme, which salted
  // them with whatever SESSION_SECRET was at the time. Safe to delete once every
  // account has signed in once, because sign-in rewrites the hash.
  LEGACY_PIN_SECRET?: string;
  // Display names permitted to call /admin/users. Empty means any authenticated
  // session may create users, which is fine for a single-user install.
  ADMIN_USER_NAMES?: string;
  // Cloudflare Access. Both set: people are identified by the email Access
  // verified, and PIN sign-in steps aside (see src/access.ts). The dashboard
  // shows both values when Access is enabled on the Worker.
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

type MediaType = "movie" | "series" | "book" | "podcast" | "youtube" | "song" | "post" | "unknown";

interface UserRow {
  id: number;
  display_name: string;
  pin_hash: string | null;
  email: string | null;
  created_at: string;
}

interface Extraction {
  title: string;
  media_type: MediaType;
  source_name: string | null;
  source_url: string | null;
  reason_saved: string | null;
  confidence: number;
  needs_clarification: boolean;
}

interface ItemRow {
  id: number;
  title: string;
  media_type: MediaType;
  status: string;
  synopsis: string | null;
  image_url: string | null;
  release_year: string | null;
  metadata_json: string;
  availability_json: string;
  external_ids_json: string;
  confidence: number | null;
  user_id: number;
}

interface Enrichment {
  provider: string;
  media_type?: MediaType;
  title?: string;
  synopsis?: string;
  image_url?: string;
  release_year?: string;
  external_ids?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  availability?: Record<string, unknown>;
}

const MAX_LIST_ITEMS = 500;

const MEDIA_TYPES = new Set(["movie", "series", "book", "podcast", "youtube", "song", "post", "unknown"]);

// --- Auth helpers ---

/**
 * PIN hashing: PBKDF2-SHA256 with a per-user random salt.
 *
 * Stated plainly, because the number matters: a 4-digit PIN is a weak credential
 * and no hash makes it strong. Plain salted SHA-256 lets an attacker who steals
 * the database sweep the entire 10^7 space in seconds. PBKDF2 at 100k iterations
 * costs ~20ms per guess, which turns that sweep into ~56 single-threaded CPU-hours
 * — parallelised across a GPU it is hours, not seconds, but it is not decisive.
 * The real protection is Cloudflare Access in front of the Worker; this raises
 * the cost of the credential itself.
 *
 * 100,000 is a hard ceiling, not a tuning choice: Cloudflare's runtime rejects
 * any higher count with "NotSupportedError: Pbkdf2 failed: iteration counts
 * above 100000 are not supported". This was 210,000 and every sign-in returned
 * 500 in production. Local Miniflare does not enforce the cap, so the tests
 * passed; do not raise it.
 *
 * Stored format: `pbkdf2$<iterations>$<saltHex>$<hashHex>`. The parameters live
 * in the row, so they can change later without a migration — old hashes keep
 * verifying and are transparently upgraded on next successful login.
 */
const PIN_HASH_ALGORITHM = "PBKDF2";
const PIN_HASH_ITERATIONS = 100_000;
const PIN_HASH_SALT_BYTES = 16;
const PIN_HASH_KEY_BYTES = 32;
const LEGACY_SHA256_PREFIX = "sha256:";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: PIN_HASH_ALGORITHM },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: PIN_HASH_ALGORITHM, hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    PIN_HASH_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function hashPin(pin: string): Promise<string> {
  const salt = hexToBytes(randomHex(PIN_HASH_SALT_BYTES));
  const hash = await pbkdf2(pin, salt, PIN_HASH_ITERATIONS);
  const hex = (b: Uint8Array) => Array.from(b).map((v) => v.toString(16).padStart(2, "0")).join("");
  return `pbkdf2$${PIN_HASH_ITERATIONS}$${hex(salt)}$${hex(hash)}`;
}

/**
 * Verifies a PIN against a stored hash and reports whether it needs rehashing.
 *
 * The rehash flag is why this returns more than a boolean: a stored `sha256:`
 * hash still verifies, but the caller must persist the new PBKDF2 value or the
 * upgrade never completes for accounts that never re-enter their PIN.
 */
async function verifyPin(pin: string, stored: string, legacySecrets: string[] = []): Promise<{ ok: boolean; needsRehash: boolean }> {
  // Legacy hashes are bare 64-char hex (the original scheme stored no prefix at
  // all), so they are recognised by shape rather than by a marker. Anything that
  // is not `pbkdf2$...` and not exactly 64 hex characters is malformed and is
  // rejected without touching the KDF.
  const isLegacy = /^[0-9a-f]{64}$/i.test(stored) || stored.startsWith(LEGACY_SHA256_PREFIX);
  if (isLegacy) {
    const expected = (stored.startsWith(LEGACY_SHA256_PREFIX) ? stored.slice(LEGACY_SHA256_PREFIX.length) : stored).toLowerCase();
    // The legacy scheme was SHA-256 over `${secret}:${pin}`, where `secret` was
    // whatever SESSION_SECRET held when the PIN was set. That is the trap: the
    // salt is a deployment setting, not a column, so rotating SESSION_SECRET
    // (which the install guide tells you to do) silently made every existing
    // PIN unverifiable and locked every account out. Each candidate the old
    // code could have used is tried; all are computed so the work does not
    // depend on which one matches.
    let ok = false;
    for (const secret of legacySecrets) {
      const data = new TextEncoder().encode(`${secret}:${pin}`);
      const digest = await crypto.subtle.digest("SHA-256", data);
      const computed = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (computed === expected) ok = true;
    }
    return { ok, needsRehash: true };
  }

  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return { ok: false, needsRehash: false };
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return { ok: false, needsRehash: false };
  const hash = await pbkdf2(pin, hexToBytes(parts[2]), iterations);
  const computed = Array.from(hash).map((v) => v.toString(16).padStart(2, "0")).join("");
  // Length-check first: subtle.verify rejects mismatched sizes, and a constant
  // time compare is pointless when the attacker controls the stored length anyway.
  if (computed.length !== parts[3].length) return { ok: false, needsRehash: false };
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ parts[3].charCodeAt(i);
  return { ok: diff === 0, needsRehash: iterations < PIN_HASH_ITERATIONS };
}

/**
 * Rejects malformed PINs before they are ever hashed.
 *
 * `maxlength` and `pattern` on the login form are client-side conveniences and
 * are trivially bypassed by posting JSON directly, so the rule has to be
 * enforced here or it is not enforced at all.
 */
function isValidPin(pin: string): boolean {
  return /^[0-9]{4,10}$/.test(pin);
}

/**
 * The looser rule applied at sign-in, as opposed to when a PIN is chosen.
 *
 * Accounts made before server-side validation existed could hold any PIN the
 * old form allowed (it took 1-6 digits, and /admin/users took anything). The
 * stored hash decides whether a PIN is right; rejecting it on format first
 * locked those accounts out for no security gain. The length cap only bounds
 * the work an anonymous request can ask the KDF to do.
 */
function isPlausiblePin(pin: unknown): pin is string {
  return typeof pin === "string" && pin.length >= 1 && pin.length <= 64;
}

/**
 * Every secret a pre-PBKDF2 PIN hash could have been salted with.
 *
 * "fallback-secret" is listed because the old Worker used it whenever
 * SESSION_SECRET was unset. It was public, which is why it no longer signs
 * anything, but hashes made with it are still in databases and still need the
 * correct PIN to match. A match is rehashed with PBKDF2 straight away.
 */
function legacyPinSecrets(env: Env): string[] {
  const candidates = [env.SESSION_SECRET?.trim(), env.LEGACY_PIN_SECRET?.trim(), "fallback-secret"];
  return [...new Set(candidates.filter((v): v is string => Boolean(v)))];
}

/**
 * A well-formed PBKDF2 hash used only as a timing equaliser for unknown names.
 *
 * It was a legacy SHA-256 hash, which costs microseconds, while real accounts
 * cost a 100k-round PBKDF2 once upgraded. That made "no such user" ~20 ms faster
 * than "wrong PIN", which enumerates names. An all-zero digest is never
 * produced in practice, so this can never authenticate anyone.
 */
const DUMMY_PIN_HASH = `pbkdf2$${PIN_HASH_ITERATIONS}$${"0".repeat(PIN_HASH_SALT_BYTES * 2)}$${"0".repeat(PIN_HASH_KEY_BYTES * 2)}`;

/**
 * The secret that signs sessions and salts legacy PIN hashes.
 *
 * This function exists because a hardcoded fallback was the worst of the original
 * auth: with `SESSION_SECRET` unset, the HMAC key was a string published in the
 * source file, so anyone who read the repo could mint a session cookie for any
 * user id and the app never complained. A missing secret now disables cookie
 * login entirely instead of silently downgrading it. Fail closed, loudly.
 */
function sessionSecretOrNull(env: Env): string | null {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret || secret === "fallback-secret") return null;
  return secret;
}

/**
 * Session cookie lifetime, in seconds.
 *
 * This was 365 days while the signed token inside it expired after 7. The server
 * rejects an expired token regardless, so the long cookie never granted extra
 * access — it just left a dead cookie in the browser for a year and made the
 * real policy invisible at the point someone reads it. Both now use this value.
 */
const SESSION_TTL_SEC = 7 * 24 * 3600;

async function signSession(payload: Record<string, unknown>, secret: string, expiresInSec = SESSION_TTL_SEC): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256" }));
  const iat = Math.floor(Date.now() / 1000);
  const body = btoa(JSON.stringify({ ...payload, iat, exp: iat + expiresInSec }));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const signature = btoa(Array.from(new Uint8Array(sig)).map(b => String.fromCharCode(b)).join(""));
  return `${data}.${signature}`;
}

async function verifySession(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // A cookie that is not valid base64 (truncated, hand-edited, written by some
  // other app on the same host) made atob throw, and the top-level catch turned
  // that into a 500 on every page, including the one that would let you sign in
  // again. A token that cannot be decoded is simply not a session.
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
  if (!valid) return null;
  try {
    const payload = JSON.parse(atob(body)) as Record<string, unknown>;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getSessionFromCookie(request: Request, secret: string): Promise<{ userId: number } | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  // Anchored to a cookie boundary: unanchored, "session=" also matched inside
  // any other cookie whose name ends that way (cf_session=, app_session=), and
  // whichever came first in the header won.
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;
  const payload = await verifySession(match[1], secret);
  if (!payload || typeof payload.userId !== "number") return null;
  return { userId: payload.userId };
}

async function sessionCookie(userId: number, secret: string): Promise<string> {
  const token = await signSession({ userId }, secret);
  // Secure is required or iOS drops the cookie when a standalone PWA is terminated
  // from the app switcher. SameSite=Lax (not Strict) so the cookie survives the
  // standalone-webview navigation model. Max-Age matches the signed token's own
  // expiry so the cookie disappears when the session actually does.
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

function clearSessionCookie(): string {
  return "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

// --- User resolution ---

async function createWebUser(env: Env, displayName: string, pin: string): Promise<number> {
  const pinHash = await hashPin(pin);
  const result = await env.DB.prepare(
    "INSERT INTO users (display_name, pin_hash) VALUES (?, ?)",
  )
    .bind(displayName, pinHash)
    .run();
  return Number(result.meta.last_row_id);
}

/**
 * Finds an account by display name, ignoring case when that is unambiguous.
 *
 * Phones capitalise the first letter of a text field, so "alex" arrives as
 * "Alex" and an exact-match lookup reports a wrong PIN for a right one. An
 * exact match still wins; otherwise a case-insensitive match is used only when
 * exactly one account fits, so two accounts differing only in case stay apart.
 */
async function getWebUserByName(env: Env, displayName: string): Promise<UserRow | null> {
  const exact = await env.DB.prepare("SELECT * FROM users WHERE display_name = ?")
    .bind(displayName)
    .first<UserRow>();
  if (exact) return exact;
  const loose = await env.DB.prepare("SELECT * FROM users WHERE display_name = ? COLLATE NOCASE LIMIT 2")
    .bind(displayName)
    .all<UserRow>();
  return loose.results?.length === 1 ? loose.results[0] : null;
}

/**
 * Checks a name and PIN, and upgrades an old-style PIN hash on success.
 *
 * Shared by PIN sign-in and by linking an email under Cloudflare Access, so
 * both get the same timing protection and the same legacy-hash handling.
 */
async function checkCredentials(env: Env, name: string, pin: string): Promise<UserRow | null> {
  const user = await getWebUserByName(env, name);
  // Verify against a dummy hash when the user is unknown so a missing
  // account and a wrong PIN take the same time, and neither is faster than
  // a real check. Without this, response time enumerates valid names.
  const stored = user?.pin_hash ?? DUMMY_PIN_HASH;
  const { ok, needsRehash } = await verifyPin(pin, stored, legacyPinSecrets(env));
  if (!ok || !user) return null;
  // Upgrade salted-SHA256 hashes (and any future weaker parameters) on
  // success. Persisting here is the only part of the migration that matters:
  // verify alone would leave the weak hash in the row forever.
  if (needsRehash) {
    await env.DB.prepare("UPDATE users SET pin_hash = ? WHERE id = ?")
      .bind(await hashPin(pin), user.id)
      .run();
  }
  return user;
}

async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

/**
 * Answers a person Access has verified whose email isn't linked to a list yet.
 *
 * The page asks for an existing list's name and PIN once, and links the email
 * to it, so the PIN proves which list is whose exactly one more time. On a
 * database with no accounts at all, it creates the first one instead.
 */
async function unlinkedResponse(request: Request, env: Env, url: URL, email: string): Promise<Response> {
  const accounts = (await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>())?.c ?? 0;

  if (request.method === "POST" && url.pathname === "/auth/link") {
    const body = await readJson<{ name?: unknown; pin?: unknown }>(request);
    const name = textField(body.name);
    if (!name || !body.pin) return json({ error: "name_and_pin_required" }, 400);
    if (!isPlausiblePin(body.pin)) return json({ error: "invalid_credentials" }, 401);
    const user = await checkCredentials(env, name, body.pin);
    if (!user) return json({ error: "invalid_credentials" }, 401);
    if (user.email && user.email !== email) {
      return json({ error: "already_linked", hint: "That list is connected to a different email." }, 409);
    }
    await env.DB.prepare("UPDATE users SET email = ? WHERE id = ?").bind(email, user.id).run();
    return json({ ok: true, user: { id: user.id, display_name: user.display_name } });
  }

  if (request.method === "POST" && url.pathname === "/setup") {
    if (accounts > 0) return json({ error: "already_initialized" }, 409);
    const name = textField((await readJson<{ name?: unknown }>(request)).name);
    if (!name) return json({ error: "name_required" }, 400);
    const result = await env.DB.prepare("INSERT INTO users (display_name, email) VALUES (?, ?)")
      .bind(name, email)
      .run();
    return json({ ok: true, userId: Number(result.meta.last_row_id), display_name: name }, 201);
  }

  if (request.method === "POST" && url.pathname === "/auth/logout") {
    return json({ ok: true, redirect: ACCESS_LOGOUT_PATH });
  }

  if (request.method === "GET" && ["/", "/dashboard", "/login", "/share"].includes(url.pathname)) {
    const next = url.pathname === "/share"
      ? shareDestination(url) ?? "/dashboard"
      : safeNextPath(url.searchParams.get("next")) ?? "/dashboard";
    return html(connectHtml(email, accounts === 0, next));
  }

  return json({ error: "not_linked", hint: "Open the app to connect this email to your list." }, 401);
}

/**
 * Where a share from another app should land: the dashboard with the shared
 * text in the box. Null when nothing usable was shared.
 */
function shareDestination(url: URL): string | null {
  // Chrome sends the shared payload as query params. X puts the permalink in
  // `url` and any user commentary in `text`; keep both so the user sees what
  // they shared before confirming.
  const sharedUrl = (url.searchParams.get("url") ?? "").trim();
  const sharedText = (url.searchParams.get("text") ?? "").trim();
  const sharedTitle = (url.searchParams.get("title") ?? "").trim();
  let payload = sharedUrl || sharedText;
  if (!payload && sharedTitle && /^https?:\/\//i.test(sharedTitle)) payload = sharedTitle;
  if (!payload) return null;
  return `/dashboard?${new URLSearchParams({ prefill: payload.slice(0, 2000) }).toString()}`;
}

/**
 * A same-site path to continue to, or null. "//host" and "/\\host" are
 * refused: browsers treat both as another site.
 */
function safeNextPath(value: string | null): string | null {
  return value && /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/.test(value) ? value : null;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function html(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

import { dashboardHtml } from "./dashboard.ts";
import { loginHtml } from "./login.ts";
import { connectHtml } from "./connect.ts";
import { accessSettings, verifyAccessToken, ACCESS_LOGOUT_PATH } from "./access.ts";
import { type AiEnv, chooseProvider, classifyWithModel } from "./ai/index.ts";
import {
  MANIFEST_JSON,
  SERVICE_WORKER_JS,
  ICON_192,
  ICON_512,
  APPLE_TOUCH_ICON,
  ICON_MASKABLE,
} from "./pwa.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const access = accessSettings(env);

      if (request.method === "GET" && url.pathname === "/health") {
        // Reports which sign-in controls are armed, never their values.
        //
        // Several routes refuse to work when a setting is missing, and a bare
        // {"status":"ok"} turns that into a silent 503 at some unrelated endpoint
        // much later. Naming the missing configuration here is the difference
        // between a five-minute diagnosis and an afternoon.
        return json({
          status: "ok",
          auth: {
            mode: access ? "cloudflare-access" : "pin",
            accessConfigured: access !== null,
            sessionSecretConfigured: sessionSecretOrNull(env) !== null,
            adminUserNamesConfigured: Boolean(env.ADMIN_USER_NAMES?.trim()),
          },
          // Which model classifies saves, by provider name only.
          ai: chooseProvider(env) ?? "none",
        });
      }

      // --- PWA files (public: they carry no data) ---

      if (request.method === "GET" && url.pathname === "/manifest.webmanifest") {
        return new Response(JSON.stringify(MANIFEST_JSON), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            // Must NOT be cached. Chrome reads the manifest at PWA install time
            // to register share targets, so a cached copy silently strands an
            // installed app on an older manifest (e.g. missing share_target).
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/sw.js") {
        return new Response(SERVICE_WORKER_JS, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/icon-192.png") {
        return pngResponse(ICON_192.data);
      }

      if (request.method === "GET" && url.pathname === "/icon-512.png") {
        return pngResponse(ICON_512.data);
      }

      if (request.method === "GET" && url.pathname === "/apple-touch-icon.png") {
        return pngResponse(APPLE_TOUCH_ICON.data);
      }

      if (request.method === "GET" && url.pathname === "/icon-maskable-512.png") {
        return pngResponse(ICON_MASKABLE.data);
      }

      // --- Who is asking ---
      //
      // With Cloudflare Access configured, the person is whoever Access
      // verified, and the PIN pages step aside: Access has already signed them
      // in. Without it, the session cookie from a PIN sign-in decides.

      let session: { userId: number } | null = null;
      if (access) {
        const identity = await verifyAccessToken(request.headers.get("Cf-Access-Jwt-Assertion"), access);
        if (!identity) {
          return json({
            error: "access_required",
            hint: "This Lighthouse opens only through Cloudflare Access. Reload the page to sign in.",
          }, 403);
        }
        const linked = await getUserByEmail(env, identity.email);
        if (!linked) return await unlinkedResponse(request, env, url, identity.email);
        session = { userId: linked.id };

        if (request.method === "GET" && (url.pathname === "/login" || url.pathname === "/")) {
          return redirect(safeNextPath(url.searchParams.get("next")) ?? "/dashboard");
        }
        if (request.method === "POST" && ["/auth/login", "/auth/link", "/setup"].includes(url.pathname)) {
          return json({ error: "signed_in_with_access", hint: "Cloudflare Access signs you in; there is no PIN to enter." }, 409);
        }
        if (request.method === "POST" && url.pathname === "/auth/logout") {
          return json({ ok: true, redirect: ACCESS_LOGOUT_PATH });
        }
      } else {
        const secret = sessionSecretOrNull(env);
        session = secret ? await getSessionFromCookie(request, secret) : null;
      }

      if (request.method === "GET" && url.pathname === "/") {
        return redirect("/dashboard");
      }

      // --- GET /share (Web Share Target from another app) ---

      if (request.method === "GET" && url.pathname === "/share") {
        const dest = shareDestination(url);
        if (!dest) return redirect("/dashboard");
        // Carry the payload through sign-in so a share while signed out is not lost.
        if (!session) return redirect(`/login?${new URLSearchParams({ next: dest }).toString()}`);
        return redirect(dest);
      }

      // --- PIN sign-in (only reached without Cloudflare Access) ---

      if (request.method === "GET" && url.pathname === "/login") {
        return html(loginHtml());
      }

      if (request.method === "POST" && url.pathname === "/auth/login") {
        const secret = sessionSecretOrNull(env);
        if (!secret) {
          // Deliberate: no secret means no signed cookie is possible. Returning 503
          // names the missing configuration instead of minting a cookie signed with
          // a key that is published in this source file.
          return json({ error: "session_secret_not_configured" }, 503);
        }
        const body = await readJson<{ name?: unknown; pin?: unknown }>(request);
        const name = textField(body.name);
        if (!name || !body.pin) return json({ error: "name_and_pin_required" }, 400);
        if (!isPlausiblePin(body.pin)) return json({ error: "invalid_credentials" }, 401);
        const user = await checkCredentials(env, name, body.pin);
        if (!user) return json({ error: "invalid_credentials" }, 401);
        return new Response(JSON.stringify({ ok: true, user: { id: user.id, display_name: user.display_name } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": await sessionCookie(user.id, secret),
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/auth/logout") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": clearSessionCookie(),
          },
        });
      }

      // --- First-run setup: create the initial account ---
      //
      // /admin/users requires an existing session, and a session requires a user,
      // so a brand-new database would have no way in.
      //
      // This route closes that gap and is safe to leave deployed precisely because
      // it only works while the users table is EMPTY. Once one account exists it
      // returns 409 forever, so it cannot be used to add accounts later — that is
      // /admin/users' job, behind a session.

      if (request.method === "POST" && url.pathname === "/setup") {
        const existing = await env.DB.prepare("SELECT COUNT(*) AS c FROM users")
          .bind()
          .first<{ c: number }>();
        if ((existing?.c ?? 0) > 0) {
          return json({ error: "already_initialized", hint: "Use /admin/users with a signed-in session." }, 409);
        }
        const body = await readJson<{ name?: unknown; pin?: unknown }>(request);
        const name = textField(body.name);
        const pin = typeof body.pin === "string" ? body.pin : "";
        if (!name || !pin) return json({ error: "name_and_pin_required" }, 400);
        if (!isValidPin(pin)) return json({ error: "pin_must_be_4_to_10_digits" }, 400);

        const secret = sessionSecretOrNull(env);
        if (!secret) return json({ error: "session_secret_not_configured" }, 503);

        const userId = await createWebUser(env, name, pin);
        return new Response(JSON.stringify({ ok: true, userId, display_name: name }), {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            // Sign the new account straight in — the person doing setup should not
            // have to immediately type the PIN they just chose.
            "Set-Cookie": await sessionCookie(userId, secret),
          },
        });
      }

      // --- Admin route: create web user ---
      //
      // Requires a signed-in person (by PIN or Access), and optionally restricts
      // creation to names in ADMIN_USER_NAMES: without the check, any POST that
      // reached the Worker would create a login.

      if (request.method === "POST" && url.pathname === "/admin/users") {
        if (!access && !sessionSecretOrNull(env)) return json({ error: "session_secret_not_configured" }, 503);
        if (!session) return json({ error: "unauthorized" }, 401);

        const body = await readJson<{ name?: unknown; pin?: unknown }>(request);
        const name = textField(body.name);
        const pin = typeof body.pin === "string" ? body.pin : "";
        if (!name || !pin) return json({ error: "name_and_pin_required" }, 400);
        if (!isValidPin(pin)) return json({ error: "pin_must_be_4_to_10_digits" }, 400);

        // Optional allow-list. Unset means any signed-in user may create users,
        // which is the right default for a single-person install; set it when the
        // Worker is shared and the first account should not be able to mint more.
        const admins = (env.ADMIN_USER_NAMES ?? "").split(",").map((v) => v.trim()).filter(Boolean);
        if (admins.length > 0) {
          const caller = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?")
            .bind(session.userId)
            .first<{ display_name: string }>();
          if (!caller || !admins.includes(caller.display_name)) {
            return json({ error: "forbidden" }, 403);
          }
        }

        if (await getWebUserByName(env, name)) return json({ error: "user_exists" }, 409);
        const userId = await createWebUser(env, name, pin);
        return json({ ok: true, userId });
      }

      // --- All routes below require a signed-in person ---

      if (request.method === "GET" && url.pathname === "/auth/me") {
        if (!session) return json({ error: "unauthorized" }, 401);
        const user = await env.DB.prepare("SELECT id, display_name FROM users WHERE id = ?")
          .bind(session.userId)
          .first<{ id: number; display_name: string }>();
        if (!user) return json({ error: "unauthorized" }, 401);
        return json({ user });
      }

      if (request.method === "GET" && url.pathname === "/dashboard") {
        if (!session) return redirect("/login");
        const user = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?")
          .bind(session.userId)
          .first<{ display_name: string }>();
        return new Response(dashboardHtml(user?.display_name ?? "User"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (!session) return json({ error: "unauthorized" }, 401);
      const userId = session.userId;

      if (request.method === "GET" && url.pathname === "/stats") {
        return json(await stats(env, userId));
      }
      if (request.method === "GET" && url.pathname === "/items") {
        // The cap was 100, and the dashboard asked for 100, so the 101st item
        // and everything older silently vanished from the app. A personal list
        // runs to hundreds, not thousands; past that this wants pagination.
        const limit = clamp(Number(url.searchParams.get("limit") ?? 25), 1, MAX_LIST_ITEMS);
        return json({ items: await listItems(env, limit, undefined, undefined, userId) });
      }

      // --- GET /pick: "what should I watch tonight?" ---
      //
      // `mode=short` weights low-commitment items so a 25-minute episode beats a
      // 3-hour film; `mode=today` is the unbiased pick.
      //
      // Ties are broken by taking a random element from the top band rather than
      // always the first row, so repeated taps do not return the same item and the
      // feature still feels like a suggestion rather than a lookup. `exclude` lets
      // the client ask for something other than the card it is already showing.
      if (request.method === "GET" && url.pathname === "/pick") {
        const mode = url.searchParams.get("mode") === "short" ? "short" : "today";
        const exclude = url.searchParams.get("exclude");
        const pool = (await listItems(env, MAX_LIST_ITEMS, undefined, undefined, userId))
          .filter((item) => ["inbox", "interested", "started"].includes(item.status));

        if (pool.length === 0) {
          return json({ error: "no_candidates", hint: "Add something to the inbox first." }, 404);
        }

        let candidates = exclude ? pool.filter((item) => String(item.id) !== exclude) : pool;
        // If excluding left nothing, fall back to the full pool rather than 404 —
        // tapping "surprise me" on a one-item inbox should still return that item.
        if (candidates.length === 0) candidates = pool;

        const ranked = [...candidates].sort((a, b) => scoreItem(b, mode === "short") - scoreItem(a, mode === "short"));
        const top = ranked[0];
        const tied = ranked.filter((item) => scoreItem(item, mode === "short") === scoreItem(top, mode === "short"));
        const item = tied[Math.floor(Math.random() * tied.length)] ?? top;

        return json({ item, mode, candidates: pool.length });
      }

      // --- POST /items: submit new recommendation via web ---

      if (request.method === "POST" && url.pathname === "/items") {
        const body = await readJson<{ text?: unknown; media_type?: string }>(request);
        if (!textField(body.text)) return json({ error: "text_required" }, 400);

        // Every capture comes through here, so this owns the whole pipeline: read
        // the shared link, classify, enrich, store. Without the link expansion the
        // model would see a bare URL with no author or post text to work from.
        const rawText = textField(body.text);
        const rawUrl = firstUrl(rawText);
        // An X or Reddit post is fetched once, here, and serves both as the
        // model's context and as the stored details. Any other link is read for
        // its title and description.
        const linksToPost = isPostUrl(rawUrl);
        const sharedPost = linksToPost ? await fetchSharedPost(rawUrl!) : null;
        const sourceContext = sharedPost ? sharedPost.context : rawUrl && !linksToPost ? await expandHtmlContext(rawUrl) : null;
        // A bare post link we could not read has no usable title. Record it as
        // needing context rather than saving a link-shaped "title" nobody can act
        // on. With a note beside the link, the note is enough to save.
        const bareLink = rawUrl !== null && rawText.replace(rawUrl, "").trim().length === 0;
        const unresolvedPost = linksToPost && !sharedPost && bareLink;

        const rawCaptureId = await addRawCapture(env, {
          userId,
          rawText,
          rawUrl,
          metadata: {
            source_platform: "web",
            selected_media_type: body.media_type ?? null,
            source_context_expanded: Boolean(sourceContext),
            needs_context: unresolvedPost,
          },
          sourcePlatform: "web",
        });

        if (unresolvedPost) {
          await env.DB.prepare("UPDATE raw_captures SET processed_status = 'needs_context' WHERE id = ?")
            .bind(rawCaptureId)
            .run();
          const where = isRedditUrl(rawUrl) ? "Reddit post" : "X post";
          return json({
            error: "source_unavailable",
            hint: `That ${where} could not be read (it may be deleted or private). Add a short note after the link, and it will save.`,
          }, 422);
        }

        const processingText = buildProcessingText(rawText, rawUrl, sourceContext);
        const extraction = await extractRecommendation(processingText, env);
        // Explicit user-selected type always wins over LLM classification.
        if (body.media_type && body.media_type !== "auto" && isMediaType(body.media_type)) {
          extraction.media_type = body.media_type as MediaType;
          extraction.needs_clarification = false;
          extraction.confidence = 1;
        }
        // Saved as a post, the post itself is the item: its own title, and its id
        // as identity. Saved as anything else (a film the post recommends, say),
        // the post was only context for finding it.
        const postEnrichment = extraction.media_type === "post" ? sharedPost?.enrichment ?? null : null;
        if (postEnrichment?.title) extraction.title = postEnrichment.title;
        let itemId = await upsertItem(env, extraction, rawCaptureId, userId, postEnrichment?.external_ids);
        const enrichUrl = extraction.media_type === "post" && linksToPost ? rawUrl : extraction.source_url;
        const enrichment = postEnrichment ?? await enrich(extraction.title, extraction.media_type, env, enrichUrl ?? undefined);
        if (enrichment.title || enrichment.synopsis || enrichment.image_url) {
          itemId = await updateItemEnrichment(env, itemId, enrichment);
        }
        await env.DB.prepare(
          "INSERT INTO enrichment_runs (item_id, raw_capture_id, status, provider) VALUES (?, ?, ?, ?)",
        )
          .bind(itemId, rawCaptureId, "success", enrichment.provider)
          .run();
        await env.DB.prepare("UPDATE raw_captures SET processed_status = 'processed' WHERE id = ?")
          .bind(rawCaptureId)
          .run();
        const item = await getItemById(env, itemId, userId);
        return json({ item, extraction });
      }

      // --- PATCH /items/:id (rename, change type, status) ---

      if (request.method === "PATCH") {
        const statusMatch = url.pathname.match(/^\/items\/(\d+)\/status$/);
        if (statusMatch) {
          const itemId = Number(statusMatch[1]);
          const body = await readJson<{ status?: unknown }>(request);
          const validStatuses = ["inbox", "interested", "started", "finished", "dropped"];
          if (typeof body.status !== "string" || !validStatuses.includes(body.status)) {
            return json({ error: "invalid_status" }, 400);
          }
          const item = await getItemById(env, itemId, userId);
          if (!item) return json({ error: "not_found" }, 404);
          await env.DB.prepare("UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
            .bind(body.status, itemId, userId)
            .run();
          const updated = await getItemById(env, itemId, userId);
          return json({ item: updated });
        }

        const itemMatch = url.pathname.match(/^\/items\/(\d+)$/);
        if (itemMatch) {
          const itemId = Number(itemMatch[1]);
          const body = await readJson<{ title?: unknown; media_type?: unknown }>(request);
          const item = await getItemById(env, itemId, userId);
          if (!item) return json({ error: "not_found" }, 404);

          const title = textField(body.title);
          if (title) {
            const newNormalized = itemIdentity(item, title);
            const conflict = await findItemByIdentity(env, newNormalized, item.media_type, item.id, userId);
            if (conflict) return json({ error: "title_conflict", conflict_title: conflict.title }, 409);
            await renameItem(env, itemId, title, userId);
          }
          if (typeof body.media_type === "string" && isMediaType(body.media_type)) {
            const newType = body.media_type as MediaType;
            const conflict = await findItemByIdentity(env, itemIdentity(item, item.title, newType), newType, item.id, userId);
            if (conflict) return json({ error: "type_conflict", conflict_title: conflict.title }, 409);
            await setItemType(env, itemId, newType, userId);
          }
          const updated = await getItemById(env, itemId, userId);
          return json({ item: updated });
        }
      }

      // --- DELETE /items/:id ---

      if (request.method === "DELETE") {
        const match = url.pathname.match(/^\/items\/(\d+)$/);
        if (match) {
          const itemId = Number(match[1]);
          const item = await getItemById(env, itemId, userId);
          if (!item) return json({ error: "not_found" }, 404);
          await deleteItem(env, itemId, userId);
          return json({ ok: true });
        }
      }

      // --- POST /items/:id/refresh ---

      if (request.method === "POST") {
        const match = url.pathname.match(/^\/items\/(\d+)\/refresh$/);
        if (match) {
          const itemId = Number(match[1]);
          const item = await getItemById(env, itemId, userId);
          if (!item) return json({ error: "not_found" }, 404);
          const enrichment = await enrich(item.title, item.media_type, env, storedSourceUrl(item) ?? undefined);
          if (!(enrichment.title || enrichment.synopsis || enrichment.image_url)) {
            return json({ error: "no_new_data" }, 404);
          }
          const keptId = await updateItemEnrichment(env, itemId, enrichment);
          await env.DB.prepare(
            "INSERT INTO enrichment_runs (item_id, status, provider) VALUES (?, ?, ?)",
          )
            .bind(keptId, "success", enrichment.provider)
            .run();
          const refreshed = await getItemById(env, keptId, userId);
          return json({ item: refreshed });
        }
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "internal_error" }, 500);
    }
  },
};

function isXUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com";
  } catch {
    return false;
  }
}

function buildProcessingText(text: string, url: string | null, sourceContext: string | null): string {
  const parts = [text];
  if (url && !text.includes(url)) parts.push(url);
  if (sourceContext) parts.push(`Source preview:\n${sourceContext}`);
  return parts.join("\n\n");
}

interface XPost {
  statusId: string | null;
  url: string;
  authorName: string | null;
  authorHandle: string | null;
  avatarUrl: string | null;
  text: string | null;
  createdAt: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  views: number | null;
  imageUrl: string | null;
}

/**
 * Fetch a single X post.
 *
 * Primary source is FxTwitter's public API (no key, no auth). Twitter's own
 * oEmbed endpoint — which this Worker used to rely on — now 301s to
 * publish.x.com and returns 404 to unauthenticated callers, so oEmbed is kept
 * only as a last-resort fallback for text-only data.
 *
 * Caveat: FxTwitter is a third-party service, not an official X API. It can
 * break or rate-limit without notice. If posts start saving empty, check here
 * first; the official replacement is the paid X API v2 bearer token.
 */
async function fetchXPost(url: string): Promise<XPost | null> {
  if (!isXUrl(url)) return null;
  const statusId = xStatusId(url);

  const fx = await fetchFxPost(url, statusId);
  if (fx) return fx;
  return await fetchXOEmbedFallback(url, statusId);
}

async function fetchFxPost(url: string, statusId: string | null): Promise<XPost | null> {
  if (!statusId) return null;
  const handle = xHandleFromUrl(url);
  // Prefer the handle form when we have one, but fall back to the id-only
  // route: shared links are often x.com/i/status/<id>, which carries no
  // handle, and that must not silently degrade to the oEmbed fallback.
  const paths = handle
    ? [`/${handle}/status/${statusId}`, `/i/status/${statusId}`]
    : [`/i/status/${statusId}`];
  for (const path of paths) {
    try {
      const response = await fetch(`https://api.fxtwitter.com${path}`, {
        headers: { "User-Agent": "LighthouseWatchlist/0.1", Accept: "application/json" },
      });
      if (!response.ok) continue;
      const body = await response.json() as {
        code?: number;
        tweet?: {
          id?: string; url?: string; text?: string; created_at?: string;
          likes?: number; retweets?: number; replies?: number; views?: number;
          author?: { name?: string; screen_name?: string; avatar_url?: string };
                  media?: { all?: Array<{ type?: string; url?: string; thumbnail_url?: string }> };
        };
      };
      const tweet = body.tweet;
      if (!tweet || body.code !== 200) continue;
      const image = pickPostImage(tweet.media?.all ?? []);
      return {
        statusId: tweet.id ?? statusId,
        url: tweet.url ?? (handle ? `https://x.com/${handle}/status/${statusId}` : `https://x.com/i/status/${statusId}`),
        authorName: tweet.author?.name?.trim() || null,
        authorHandle: tweet.author?.screen_name ?? handle,
        avatarUrl: tweet.author?.avatar_url ?? null,
        text: tweet.text?.trim() || null,
        createdAt: tweet.created_at ?? null,
        likes: tweet.likes ?? null,
        retweets: tweet.retweets ?? null,
        replies: tweet.replies ?? null,
        views: tweet.views ?? null,
        imageUrl: image,
      };
    } catch (error) {
      console.error("FxTweet fetch failed", path, error);
    }
  }
  return null;
}

/**
 * Choose a renderable still image for a post card.
 *
 * Only photos and video *thumbnails* are usable. A video's `url` is an MP4:
 * storing it in image_url produces a broken-image card, because the dashboard
 * renders that field in an <img> tag. Prefer photos, then any thumbnail.
 */
function pickPostImage(
  media: Array<{ type?: string; url?: string; thumbnail_url?: string }>,
): string | null {
  const isStill = (url: string | undefined) => !!url && !/\.(mp4|m3u8|mov)(\?|$)/i.test(url);
  for (const item of media) {
    if (item.type === "photo" && isStill(item.url)) return item.url ?? null;
  }
  for (const item of media) {
    if (isStill(item.thumbnail_url)) return item.thumbnail_url ?? null;
  }
  for (const item of media) {
    if (isStill(item.url)) return item.url ?? null;
  }
  return null;
}

async function fetchXOEmbedFallback(url: string, statusId: string | null): Promise<XPost | null> {
  const normalizedUrl = statusId ? `https://x.com/i/status/${statusId}` : url;
  const oembedUrl = `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(normalizedUrl)}`;
  try {
    const response = await fetch(oembedUrl, {
      headers: { "User-Agent": "LighthouseWatchlist/0.1", Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json() as { html?: string; author_name?: string; author_url?: string };
    const text = stripHtml(data.html ?? "").trim();
    const handle = (data.author_url ?? "").match(/\/([A-Za-z0-9_]{1,15})\/?$/)?.[1] ?? null;
    return {
      statusId,
      url: normalizedUrl,
      authorName: data.author_name?.trim() || null,
      authorHandle: handle,
      avatarUrl: null,
      text: text.length ? text : null,
      createdAt: null,
      likes: null, retweets: null, replies: null, views: null,
      imageUrl: null,
    };
  } catch (error) {
    console.error("X oEmbed fallback failed", error);
    return null;
  }
}

function xHandleFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
    return seg && /^@[A-Za-z0-9_]{1,15}$/.test(seg) ? seg.slice(1) : null;
  } catch {
    return null;
  }
}

function xPostContext(post: XPost): string | null {
  const pieces = [
    post.authorName ? `Author: ${post.authorName}${post.authorHandle ? ` (@${post.authorHandle})` : ""}` : "",
    post.text ?? "",
    `URL: ${post.url}`,
  ].filter(Boolean);
  const context = pieces.join("\n");
  return context.length > post.url.length + 10 ? trim(context, 1200) : null;
}

/**
 * X/Twitter post enrichment via the FxTwitter public API.
 */
async function xPostEnrich(sourceUrl: string | null, fallbackTitle: string): Promise<Enrichment> {
  const url = sourceUrl ?? "";
  if (!isXUrl(url)) return { provider: "none" };
  const post = await fetchXPost(url);
  if (!post) return { provider: "none" };
  return xPostEnrichment(post, fallbackTitle);
}

function xPostEnrichment(post: XPost, fallbackTitle: string): Enrichment {
  const metadata: Record<string, unknown> = { platform: "x" };
  if (post.authorName) metadata.author_name = post.authorName;
  if (post.authorHandle) metadata.author_handle = post.authorHandle;
  if (post.avatarUrl) metadata.avatar_url = post.avatarUrl;
  if (post.createdAt) metadata.published_at = post.createdAt;
  if (post.likes !== null) metadata.like_count = post.likes;
  if (post.retweets !== null) metadata.retweet_count = post.retweets;
  if (post.replies !== null) metadata.reply_count = post.replies;
  if (post.views !== null) metadata.view_count = post.views;
  const title = post.text ? trim(post.text.split("\n")[0], 120) : fallbackTitle;
  const releaseYear = post.createdAt ? post.createdAt.slice(-4) : null;
  return {
    provider: "fxtwitter",
    media_type: "post",
    title,
    synopsis: post.text ?? undefined,
    image_url: post.imageUrl ?? undefined,
    release_year: releaseYear ?? undefined,
    external_ids: post.statusId ? { x_status_id: post.statusId } : undefined,
    metadata,
    availability: { post_url: post.url },
  };
}

function xStatusId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

const META_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// --- Reddit posts ---
//
// A Reddit post is a first-class item, like an X post: its title, subreddit,
// author and (when Reddit allows it) text, image and votes.
//
// What works from a Worker, measured from Cloudflare's network in Oct 2026:
//   - share links (reddit.com/r/<sub>/s/<code>, what the Reddit app shares)
//     answer with a 301 to the post: read, never followed;
//   - the JSON API (by_id, comments/<id>.json, api.reddit.com) is 403;
//   - the post page is an 8 KB bot check with no title or Open Graph tags;
//   - oEmbed (reddit.com/oembed) answers 200 with the title and author, and its
//     embed links to the canonical permalink, which names the real subreddit.
// So the chain is JSON first (richer, in case Reddit lets a deployment in),
// then oEmbed. If both fail the save asks for a note, as an unreadable X post
// does, instead of filing a bare link.

const REDDIT_HOSTS = new Set(["reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com", "m.reddit.com", "redd.it"]);
const REDDIT_UA = "LighthouseWatchlist/1.0 (+https://github.com/khubli/lighthouse)";

function isRedditUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return REDDIT_HOSTS.has(new URL(url).hostname.toLowerCase().replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/** A link to one post: a /comments/ permalink, an app share link, or redd.it/<id>. */
function isRedditPostUrl(url: string | null): boolean {
  if (!url || !isRedditUrl(url)) return false;
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") === "redd.it") return /^\/[a-z0-9]+\/?$/i.test(parsed.pathname);
  return /\/comments\/[a-z0-9]+/i.test(parsed.pathname) || /\/s\/[A-Za-z0-9]+\/?$/.test(parsed.pathname);
}

/** The canonical permalink for a post link, resolving share links. Null when it isn't a post. */
async function resolveRedditPermalink(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase().replace(/^www\./, "") === "redd.it") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return id ? `https://www.reddit.com/comments/${id}/` : null;
  }
  if (/\/s\/[A-Za-z0-9]+\/?$/.test(parsed.pathname)) {
    try {
      const res = await fetch(`https://www.reddit.com${parsed.pathname}`, {
        redirect: "manual",
        headers: { "User-Agent": REDDIT_UA },
      });
      const location = res.headers.get("Location");
      if (!location) return null;
      parsed = new URL(location, "https://www.reddit.com");
    } catch (error) {
      console.error("Reddit share link failed", error);
      return null;
    }
  }
  const match = parsed.pathname.match(/^(\/r\/[^/]+)?\/comments\/([a-z0-9]+)(\/[^/]+)?/i);
  return match ? `https://www.reddit.com${match[0]}/` : null;
}

interface RedditPost {
  id: string;
  url: string;
  title: string;
  text: string | null;
  author: string | null;
  subreddit: string | null;
  score: number | null;
  comments: number | null;
  createdAt: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  provider: "reddit" | "reddit_oembed";
}

async function fetchRedditPost(url: string): Promise<RedditPost | null> {
  const permalink = await resolveRedditPermalink(url);
  const id = permalink?.match(/\/comments\/([a-z0-9]+)/i)?.[1];
  if (!permalink || !id) return null;
  return (await fetchRedditJson(id, permalink)) ?? (await fetchRedditOEmbed(id, permalink));
}

async function fetchRedditJson(id: string, permalink: string): Promise<RedditPost | null> {
  try {
    // raw_json=1 returns URLs unescaped; without it every preview URL carries &amp;.
    const res = await fetch(`https://www.reddit.com/comments/${id}.json?limit=1&raw_json=1`, {
      headers: { "User-Agent": REDDIT_UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json() as Array<{ data?: { children?: Array<{ data?: Record<string, unknown> }> } }>;
    const post = Array.isArray(body) ? body[0]?.data?.children?.[0]?.data : undefined;
    if (!post || typeof post.title !== "string" || !post.title.trim()) return null;
    const created = Number(post.created_utc);
    const linkUrl = typeof post.url_overridden_by_dest === "string" ? post.url_overridden_by_dest : null;
    const subreddit = typeof post.subreddit_name_prefixed === "string" ? post.subreddit_name_prefixed : null;
    return {
      id,
      url: typeof post.permalink === "string" ? `https://www.reddit.com${post.permalink}` : permalink,
      title: post.title.trim(),
      text: typeof post.selftext === "string" && post.selftext.trim() ? post.selftext.trim() : null,
      author: typeof post.author === "string" && post.author !== "[deleted]" ? post.author : null,
      subreddit,
      score: Number.isFinite(Number(post.score)) ? Number(post.score) : null,
      comments: Number.isFinite(Number(post.num_comments)) ? Number(post.num_comments) : null,
      createdAt: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : null,
      imageUrl: redditImage(post, linkUrl),
      linkUrl: linkUrl && !linkUrl.includes("reddit.com") ? linkUrl : null,
      provider: "reddit",
    };
  } catch (error) {
    console.error("Reddit JSON fetch failed", error);
    return null;
  }
}

/** A still image for the card: the preview, an image post's own file, or the thumbnail. */
function redditImage(post: Record<string, unknown>, linkUrl: string | null): string | null {
  const preview = (post.preview as { images?: Array<{ source?: { url?: string } }> } | undefined)?.images?.[0]?.source?.url;
  if (preview?.startsWith("https://")) return preview;
  if (linkUrl && /^https:\/\/i\.redd\.it\/.+\.(jpe?g|png|gif|webp)$/i.test(linkUrl)) return linkUrl;
  const thumbnail = typeof post.thumbnail === "string" ? post.thumbnail : "";
  return thumbnail.startsWith("https://") ? thumbnail : null;
}

async function fetchRedditOEmbed(id: string, permalink: string): Promise<RedditPost | null> {
  try {
    const res = await fetch(`https://www.reddit.com/oembed?url=${encodeURIComponent(permalink)}`, {
      headers: { "User-Agent": REDDIT_UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json() as { title?: string; author_name?: string; html?: string };
    const title = decodeHtmlEntities(data.title?.trim() ?? "");
    // A removed post still answers, titled "[deleted by user]": nothing to save.
    if (!title || /^\[(deleted|removed)/i.test(title)) return null;
    const href = (data.html ?? "").match(/href="(https:\/\/www\.reddit\.com\/r\/[^"/]+\/comments\/[^"]+)"/)?.[1];
    const url = href ? decodeHtmlEntities(href).split("?")[0] : permalink;
    return {
      id,
      url,
      title,
      text: null,
      author: data.author_name?.trim() || null,
      subreddit: url.match(/\/(r\/[^/]+)\//)?.[1] ?? null,
      score: null,
      comments: null,
      createdAt: null,
      imageUrl: null,
      linkUrl: null,
      provider: "reddit_oembed",
    };
  } catch (error) {
    console.error("Reddit oEmbed fetch failed", error);
    return null;
  }
}

function redditPostContext(post: RedditPost): string {
  return trim([
    post.title,
    post.text ? trim(post.text, 800) : "",
    post.subreddit ? `Source: ${post.subreddit}` : "",
    post.author ? `Author: u/${post.author}` : "",
    post.linkUrl ? `Links to: ${post.linkUrl}` : "",
    `URL: ${post.url}`,
  ].filter(Boolean).join("\n\n"), 2000);
}

async function redditPostEnrich(sourceUrl: string | null, fallbackTitle: string): Promise<Enrichment> {
  if (!isRedditPostUrl(sourceUrl)) return { provider: "none" };
  const post = await fetchRedditPost(sourceUrl!);
  return post ? redditPostEnrichment(post, fallbackTitle) : { provider: "none" };
}

function redditPostEnrichment(post: RedditPost, fallbackTitle: string): Enrichment {
  const metadata: Record<string, unknown> = { platform: "reddit" };
  if (post.author) metadata.author_handle = post.author;
  if (post.subreddit) metadata.subreddit = post.subreddit;
  if (post.score !== null) metadata.score = post.score;
  if (post.comments !== null) metadata.comment_count = post.comments;
  if (post.createdAt) metadata.published_at = post.createdAt;
  if (post.linkUrl) metadata.link_url = post.linkUrl;
  return {
    provider: post.provider,
    media_type: "post",
    title: trim(post.title, 160) || fallbackTitle,
    synopsis: post.text ?? undefined,
    image_url: post.imageUrl ?? undefined,
    release_year: post.createdAt?.slice(0, 4),
    external_ids: { reddit_post_id: post.id },
    metadata,
    availability: { post_url: post.url },
  };
}

// --- Shared posts (X and Reddit) ---

function isPostUrl(url: string | null): boolean {
  return (isXUrl(url) && xStatusId(url ?? "") !== null) || isRedditPostUrl(url);
}

/**
 * Fetches a shared X or Reddit post once, for both the model's context and the
 * stored details. Null when the link isn't a post or the post can't be read.
 */
async function fetchSharedPost(url: string): Promise<{ context: string | null; enrichment: Enrichment } | null> {
  if (isXUrl(url) && xStatusId(url)) {
    const post = await fetchXPost(url);
    // An image-only post has no text to title it with.
    const fallback = post?.authorHandle ? `Post by @${post.authorHandle}` : "X post";
    return post ? { context: xPostContext(post), enrichment: xPostEnrichment(post, fallback) } : null;
  }
  if (isRedditPostUrl(url)) {
    const post = await fetchRedditPost(url);
    return post ? { context: redditPostContext(post), enrichment: redditPostEnrichment(post, url) } : null;
  }
  return null;
}

/**
 * The identity a post is de-duplicated on. Items are unique on
 * (normalized_title, media_type, user), which suits films and books but not
 * posts: Reddit titles repeat ("Book recommendations?"), and two different
 * posts with one title would merge, the second overwriting the first. A post's
 * real identity is its id, so it is part of the normalized title.
 */
function postIdentityKey(externalIds: Record<string, unknown> | undefined): string | null {
  if (!externalIds) return null;
  if (externalIds.x_status_id) return `x ${String(externalIds.x_status_id)}`;
  if (externalIds.reddit_post_id) return `reddit ${String(externalIds.reddit_post_id).toLowerCase()}`;
  return null;
}

function identityTitle(title: string, mediaType: MediaType, externalIds?: Record<string, unknown>): string {
  const key = mediaType === "post" ? postIdentityKey(externalIds) : null;
  return key ? `${normalizeTitle(title)} ${key}` : normalizeTitle(title);
}

function itemIdentity(item: ItemRow, title = item.title, mediaType: MediaType = item.media_type): string {
  return identityTitle(title, mediaType, parseJson(item.external_ids_json));
}

function extractMeta(html: string, property: string): string | null {
  const propRe = new RegExp(`(?:property|name)=["']${property}["']`, "i");
  const tagRe = /<meta[\s\S]*?\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tag = match[0];
    if (propRe.test(tag)) {
      const q = tag.match(/content=(["'])/i);
      if (!q) continue;
      const c = tag.match(new RegExp(`content=${q[1]}([^${q[1]}]*)${q[1]}`, "i"));
      if (c) return decodeHtmlEntities(c[1].trim());
    }
  }
  return null;
}

function extractTitleTag(content: string): string | null {
  const m = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : null;
}

async function expandHtmlContext(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": META_UA },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Limit to first 50KB for performance
    const head = html.slice(0, 50000);
    const pieces = [
      extractMeta(head, "og:title") || extractMeta(head, "twitter:title") || extractTitleTag(head),
      extractMeta(head, "og:description") || extractMeta(head, "twitter:description") || extractMeta(head, "description"),
      extractMeta(head, "og:site_name") ? `Source: ${extractMeta(head, "og:site_name")}` : "",
      `URL: ${url}`,
    ].filter(Boolean);
    const context = pieces.join("\n\n");
    return context.length > url.length + 10 ? trim(context, 2000) : null;
  } catch (error) {
    console.error("HTML fetch failed", error);
    return null;
  }
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    mdash: "-",
    ndash: "-",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return `&${entity};`;
  });
}

async function extractRecommendation(text: string, env: Env): Promise<Extraction> {
  const data = await classifyWithModel(text, env);
  return data ? coerceExtraction(data, text) : heuristicExtract(text);
}

async function enrich(title: string, mediaType: MediaType, env: Env, sourceUrl?: string): Promise<Enrichment> {
  if (mediaType === "movie" || mediaType === "series") {
    if (env.TMDB_API_KEY) {
      const result = await tmdbEnrich(title, mediaType, env);
      if (result.title || result.synopsis) return result;
    }
    return { provider: "none" };
  }
  if (mediaType === "book") {
    return await bookEnrich(title, env);
  }
  if (mediaType === "podcast") {
    return await podcastEnrich(title);
  }
  if (mediaType === "youtube") {
    return await youtubeEnrich(sourceUrl ?? null, title, env);
  }
  if (mediaType === "song") {
    if (sourceUrl && parseYouTubeId(sourceUrl)) {
      const result = await youtubeEnrich(sourceUrl, title, env);
      if (result.title || result.synopsis) {
        if (!result.metadata) result.metadata = {};
        const parsed = parseSongArtist(result.title ?? title);
        if (parsed.artist) result.metadata.artist = parsed.artist;
        if (parsed.songTitle) result.title = parsed.songTitle;
        return result;
      }
    }
    const parsed = parseSongArtist(title);
    const meta: Record<string, unknown> = {};
    if (parsed.artist) meta.artist = parsed.artist;
    return { provider: "none", title: parsed.songTitle || title, metadata: Object.keys(meta).length ? meta : undefined };
  }
  if (mediaType === "post") {
    if (isRedditPostUrl(sourceUrl ?? null)) return await redditPostEnrich(sourceUrl ?? null, title);
    return await xPostEnrich(sourceUrl ?? null, title);
  }
  // unknown — try all providers
  if (env.TMDB_API_KEY) {
    const tmdb = await tmdbEnrich(title, "movie", env);
    if (tmdb.title || tmdb.synopsis) return tmdb;
  }
  const book = await bookEnrich(title, env);
  if (book.title || book.synopsis) return book;
  return await podcastEnrich(title);
}

async function tmdbEnrich(title: string, mediaType: MediaType, env: Env): Promise<Enrichment> {
  const searchType = mediaType === "series" ? "tv" : "movie";
  const search = await fetch(
    `https://api.themoviedb.org/3/search/${searchType}?api_key=${encodeURIComponent(env.TMDB_API_KEY ?? "")}&query=${encodeURIComponent(title)}&include_adult=false`,
  );
  if (!search.ok) return { provider: "tmdb" };
  const searchJson = await search.json() as { results?: Array<Record<string, unknown>> };
  if ((!searchJson.results || searchJson.results.length === 0) && mediaType === "unknown") {
    return tmdbEnrich(title, "series", env);
  }
  const best = searchJson.results?.[0];
  if (!best) return { provider: "tmdb" };

  const tmdbId = best.id as number;
  const detailsType = searchType === "tv" ? "tv" : "movie";
  const details = await fetch(`https://api.themoviedb.org/3/${detailsType}/${tmdbId}?api_key=${encodeURIComponent(env.TMDB_API_KEY ?? "")}`);
  const detailsJson = details.ok ? await details.json() as Record<string, unknown> : {};
  const providers = await fetch(`https://api.themoviedb.org/3/${detailsType}/${tmdbId}/watch/providers?api_key=${encodeURIComponent(env.TMDB_API_KEY ?? "")}`);
  const providerJson = providers.ok ? await providers.json() as { results?: Record<string, unknown> } : {};
  const region = env.DEFAULT_REGION ?? "IN";
  const regionalProviders = (providerJson.results?.[region] ?? {}) as Record<string, unknown>;
  const posterPath = best.poster_path as string | undefined;
  const releaseDate = (best.release_date ?? best.first_air_date ?? "") as string;

  return {
    provider: "tmdb",
    media_type: searchType === "tv" ? "series" : "movie",
    title: (best.title ?? best.name) as string | undefined,
    synopsis: best.overview as string | undefined,
    image_url: posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : undefined,
    release_year: releaseDate ? releaseDate.slice(0, 4) : undefined,
    external_ids: { tmdb: tmdbId },
    metadata: {
      rating: best.vote_average,
      vote_count: best.vote_count,
      genres: Array.isArray(detailsJson.genres)
        ? detailsJson.genres.map((genre) => (genre as { name?: string }).name).filter(Boolean)
        : [],
      runtime: detailsJson.runtime,
      episode_run_time: detailsJson.episode_run_time,
      number_of_seasons: detailsJson.number_of_seasons,
      homepage: detailsJson.homepage,
    },
    availability: { region, tmdb_watch_providers: regionalProviders },
  };
}

async function bookEnrich(title: string, env: Env): Promise<Enrichment> {
  const result = env.GOOGLE_BOOKS_API_KEY
    ? await googleBooksEnrich(title, env)
    : null;
  if (result?.title || result?.synopsis) return result;
  return await openLibraryEnrich(title);
}

async function googleBooksEnrich(title: string, env: Env): Promise<Enrichment | null> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&key=${encodeURIComponent(env.GOOGLE_BOOKS_API_KEY ?? "")}&maxResults=1`,
    );
    if (!response.ok) return null;
    const data = await response.json() as { items?: Array<Record<string, unknown>> };
    const item = data.items?.[0];
    if (!item) return null;
    return googleBooksToEnrichment(item);
  } catch (error) {
    console.error("Google Books API failed", error);
    return null;
  }
}

function googleBooksToEnrichment(item: Record<string, unknown>): Enrichment {
  const volumeInfo = (item.volumeInfo ?? {}) as Record<string, unknown>;
  const identifiers = (volumeInfo.industryIdentifiers ?? []) as Array<Record<string, unknown>>;
  const isbn = identifiers.find(
    (id) => id.type === "ISBN_13" || id.type === "ISBN_10",
  )?.identifier;
  const images = volumeInfo.imageLinks as Record<string, string> | undefined;
  const thumbnail = images?.thumbnail ?? images?.smallThumbnail;
  const imageUrl = thumbnail
    ? thumbnail.replace(/^http:/, "https:").split("&zoom=")[0] + "&zoom=2"
    : undefined;
  const publishedDate = String(volumeInfo.publishedDate ?? "");
  const authors = volumeInfo.authors as string[] | undefined;
  const categories = volumeInfo.categories as string[] | undefined;

  return {
    provider: "google_books",
    title: String(volumeInfo.title ?? ""),
    synopsis: String(volumeInfo.description ?? ""),
    image_url: imageUrl,
    release_year: publishedDate.slice(0, 4) || undefined,
    external_ids: {
      google_books: item.id,
      ...(isbn ? { isbn: String(isbn) } : {}),
    },
    metadata: {
      authors: authors ?? [],
      page_count: volumeInfo.pageCount,
      categories: categories ?? [],
      average_rating: volumeInfo.averageRating,
      ratings_count: volumeInfo.ratingsCount,
      publisher: volumeInfo.publisher,
    },
    availability: {
      info_link: volumeInfo.infoLink,
      preview_link: volumeInfo.previewLink,
    },
  };
}

async function openLibraryEnrich(title: string): Promise<Enrichment> {
  try {
    const response = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(title)}&limit=1&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject,isbn,publisher,description,subtitle`,
    );
    if (!response.ok) return { provider: "none" };
    const data = await response.json() as { docs?: Array<Record<string, unknown>> };
    const doc = data.docs?.[0];
    if (!doc) return { provider: "none" };
    return openLibraryToEnrichment(doc);
  } catch (error) {
    console.error("Open Library API failed", error);
    return { provider: "none" };
  }
}

function openLibraryToEnrichment(doc: Record<string, unknown>): Enrichment {
  const coverId = doc.cover_i as number | undefined;
  const firstPublishYear = doc.first_publish_year;
  const authors = doc.author_name as string[] | undefined;
  const subjects = doc.subject as string[] | undefined;
  const isbns = doc.isbn as string[] | undefined;

  return {
    provider: "open_library",
    title: String(doc.title ?? ""),
    synopsis: String(doc.description ?? doc.subtitle ?? ""),
    image_url: coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
      : undefined,
    release_year: firstPublishYear ? String(firstPublishYear) : undefined,
    external_ids: {
      open_library: doc.key,
      ...(isbns?.length ? { isbn: isbns[0] } : {}),
    },
    metadata: {
      authors: authors ?? [],
      page_count: doc.number_of_pages_median,
      categories: subjects?.slice(0, 5) ?? [],
      publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher,
    },
    availability: {
      info_link: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
    },
  };
}

async function podcastEnrich(title: string): Promise<Enrichment> {
  return await gpodderEnrich(title);
}

async function gpodderEnrich(title: string): Promise<Enrichment> {
  try {
    const url = `https://gpodder.net/search.json?q=${encodeURIComponent(title)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "LighthouseWatchlist/1.0", Accept: "application/json" },
    });
    if (!response.ok) { console.log("GPODDER http error", { title, status: response.status }); return { provider: "none" }; }
    const data = await response.json() as Array<Record<string, unknown>>;
    const normalizedQuery = normalizeTitle(title);
    const scored = data.map((r) => {
      const normalizedResult = normalizeTitle(String(r.title ?? ""));
      let score = 0;
      if (normalizedResult === normalizedQuery) score = 3;
      else if (normalizedResult.includes(normalizedQuery) || normalizedQuery.includes(normalizedResult)) score = 2;
      else {
        const queryWords = new Set(normalizedQuery.split(" "));
        const resultWords = new Set(normalizedResult.split(" "));
        let matches = 0;
        for (const w of queryWords) if (w.length > 1 && resultWords.has(w)) matches++;
        score = matches / Math.max(queryWords.size, 1);
      }
      return { ...r, _score: score } as Record<string, unknown>;
    });
    scored.sort((a, b) => (b._score as number) - (a._score as number));
    const best = scored[0];
    if (!best || (best._score as number) < 0.5) return { provider: "none" };
    const imageUrl = best.logo_url ? String(best.logo_url) : best.scaled_logo_url ? String(best.scaled_logo_url) : undefined;
    return {
      provider: "gpodder",
      title: String(best.title ?? ""),
      synopsis: String(best.description ?? ""),
      image_url: imageUrl,
      metadata: {
        publisher: best.author,
      },
      availability: {
        rss_feed: best.url,
        website: best.website,
      },
    };
  } catch (error) {
    console.error("gpodder.net API failed", error);
    return { provider: "none" };
  }
}

function parseYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      let id: string | null = parsed.searchParams.get("v");
      if (id) return id;
      const patterns = ["/watch/", "/embed/", "/shorts/", "/live/", "/v/"];
      for (const p of patterns) {
        if (parsed.pathname.startsWith(p)) {
          id = parsed.pathname.slice(p.length).split("/")[0] || null;
          if (id) return id;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function youtubeEnrich(url: string | null, title: string, env: Env): Promise<Enrichment> {
  const videoId = url ? parseYouTubeId(url) : null;
  if (!videoId) return { provider: "none" };

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const enrichment: Enrichment = {
    provider: "youtube_oembed",
    availability: { video_url: videoUrl, video_id: videoId },
  };

  // oEmbed enrichment
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: { "User-Agent": "LighthouseWatchlist/0.1" },
    });
    if (response.ok) {
      const data = await response.json() as {
        title?: string; author_name?: string; author_url?: string;
        thumbnail_url?: string; thumbnail_width?: number; thumbnail_height?: number;
      };
      enrichment.title = data.title;
      enrichment.image_url = data.thumbnail_url;
      enrichment.metadata = {
        ...enrichment.metadata,
        channel_name: data.author_name,
        channel_url: data.author_url,
      };
    }
  } catch (error) {
    console.error("YouTube oEmbed fetch failed", error);
  }

  // YouTube Data API v3 enrichment (if key is available)
  if (env.GOOGLE_BOOKS_API_KEY) {
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${encodeURIComponent(env.GOOGLE_BOOKS_API_KEY)}`;
      const apiResponse = await fetch(apiUrl);
      if (!apiResponse.ok) {
        console.error(`YouTube Data API error (${apiResponse.status})`, await apiResponse.text().catch(() => ""));
      } else {
        const apiData = await apiResponse.json() as { items?: Array<Record<string, unknown>> };
        const item = apiData.items?.[0];
        if (item) {
          const snippet = item.snippet as Record<string, unknown> | undefined;
          const contentDetails = item.contentDetails as Record<string, unknown> | undefined;
          const statistics = item.statistics as Record<string, unknown> | undefined;

          if (snippet) {
            if (!enrichment.title) enrichment.title = snippet.title as string;
            if (!enrichment.image_url) {
              const thumbnails = snippet.thumbnails as Record<string, unknown> | undefined;
              const high = thumbnails?.high as Record<string, unknown> | undefined;
              if (high?.url) enrichment.image_url = high.url as string;
            }
            if (!enrichment.metadata) enrichment.metadata = {};
            enrichment.metadata.channel_name = snippet.channelTitle as string || enrichment.metadata.channel_name;
            enrichment.metadata.channel_url = snippet.channelId
              ? `https://www.youtube.com/channel/${snippet.channelId}`
              : enrichment.metadata.channel_url;
            if (!enrichment.synopsis) enrichment.synopsis = snippet.description as string;
            if (snippet.publishedAt) {
              const published = String(snippet.publishedAt);
              enrichment.release_year = published.slice(0, 4);
              if (enrichment.metadata) enrichment.metadata.published_at = published;
            }
          }

          if (contentDetails) {
            const iso = contentDetails.duration as string;
            if (iso) {
              const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
              if (match) {
                const h = Number(match[1] || 0);
                const m = Number(match[2] || 0);
                const s = Number(match[3] || 0);
                const totalSeconds = h * 3600 + m * 60 + s;
                if (enrichment.metadata) enrichment.metadata.duration_seconds = totalSeconds;
              }
            }
          }

          if (statistics) {
            if (enrichment.metadata) {
              enrichment.metadata.view_count = Number(statistics.viewCount || 0);
              enrichment.metadata.like_count = Number(statistics.likeCount || 0);
            }
          }

          enrichment.provider = "youtube";
        }
      }
    } catch (error) {
      console.error("YouTube Data API fetch failed", error);
    }
  }

  return enrichment;
}

async function addRawCapture(
  env: Env,
  input: { userId: number; rawText: string; rawUrl: string | null; metadata: Record<string, unknown>; sourcePlatform?: string },
): Promise<number> {
  // Every capture is stored before it is parsed, so a failed classification
  // never loses what was shared.
  const result = await env.DB.prepare(
    "INSERT INTO raw_captures (user_id, raw_text, raw_url, message_metadata_json, source_platform) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(input.userId, input.rawText, input.rawUrl, JSON.stringify(input.metadata), input.sourcePlatform ?? "web")
    .run();
  return Number(result.meta.last_row_id);
}

async function upsertItem(env: Env, extraction: Extraction, rawCaptureId: number, userId: number, externalIds?: Record<string, unknown>): Promise<number> {
  const normalized = identityTitle(extraction.title, extraction.media_type, externalIds);
  const existing = await env.DB.prepare("SELECT id FROM items WHERE normalized_title = ? AND media_type = ? AND user_id = ?")
    .bind(normalized, extraction.media_type, userId)
    .first<{ id: number }>();

  let itemId: number;
  if (existing) {
    itemId = existing.id;
    await env.DB.prepare("UPDATE items SET confidence = COALESCE(?, confidence), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(extraction.confidence, itemId)
      .run();
  } else {
    const reusable = await findReusableItemForUpsert(env, normalized, extraction.media_type, userId);
    if (reusable) {
      itemId = reusable.id;
      await env.DB.prepare(
        "UPDATE items SET media_type = ?, confidence = COALESCE(?, confidence), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
        .bind(extraction.media_type === "unknown" ? reusable.media_type : extraction.media_type, extraction.confidence, itemId)
        .run();
    } else {
    const result = await env.DB.prepare(
      "INSERT INTO items (title, normalized_title, media_type, confidence, user_id) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(extraction.title, normalized, extraction.media_type, extraction.confidence, userId)
      .run();
    itemId = Number(result.meta.last_row_id);
    }
  }

  await env.DB.prepare(
    "INSERT INTO item_sources (item_id, raw_capture_id, source_name, source_url, reason_saved) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(itemId, rawCaptureId, extraction.source_name, extraction.source_url, extraction.reason_saved)
    .run();
  return itemId;
}

/**
 * Recover the source URL from a stored item. A post's identity lives entirely
 * in its URL, so /refresh has no title to work from without this.
 */
function storedSourceUrl(item: ItemRow): string | null {
  const availability = parseJson(item.availability_json);
  const candidates = [availability.post_url, availability.video_url, availability.apple_url, availability.info_link];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

/**
 * Writes enrichment onto an item and returns the id of the item that holds it.
 *
 * Enrichment can rename an item to a title the same person already has, and
 * (title, type, user) is unique. The two are merged when that happens, so the
 * returned id is the surviving item, which may not be the one passed in.
 *
 * Two defects lived here. The duplicate check ran only when the provider set a
 * media_type (TMDB and X do; books, podcasts and video do not), so enriching a
 * book onto an existing title hit the unique index and the save failed with a
 * 500. And the check was not scoped to the user, so with two accounts one
 * person's save could be merged into, and vanish into, the other's item.
 */
async function updateItemEnrichment(env: Env, itemId: number, enrichment: Enrichment): Promise<number> {
  const current = await getItemById(env, itemId);
  if (!current) return itemId;
  // The type the row will have after the UPDATE below, which only fills in an
  // unknown type and otherwise keeps the one the user chose.
  const finalType = current.media_type === "unknown" && enrichment.media_type ? enrichment.media_type : current.media_type;
  // Ids merge rather than replace: a provider that returns none (a YouTube
  // lookup, a failed refresh) must not wipe the ones already stored.
  const externalIds = { ...parseJson(current.external_ids_json), ...(enrichment.external_ids ?? {}) };
  const enrichedNormalized = enrichment.title ? identityTitle(enrichment.title, finalType, externalIds) : null;
  const conflict = enrichedNormalized
    ? await findItemByIdentity(env, enrichedNormalized, finalType, itemId, current.user_id)
    : null;
  if (conflict) {
    await mergeItems(env, conflict.id, itemId);
    itemId = conflict.id;
  }
  const metadata = { ...parseJson(current.metadata_json), ...(enrichment.metadata ?? {}) };
  const availability = { ...parseJson(current.availability_json), ...(enrichment.availability ?? {}) };
  await env.DB.prepare(
    `UPDATE items
     SET title = COALESCE(?, title),
         normalized_title = COALESCE(?, normalized_title),
         media_type = CASE WHEN media_type = 'unknown' AND ? IS NOT NULL THEN ? ELSE media_type END,
         synopsis = COALESCE(?, synopsis),
         image_url = COALESCE(?, image_url),
         release_year = COALESCE(?, release_year),
         external_ids_json = ?,
         metadata_json = ?,
         availability_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      enrichment.title ?? null,
      enrichedNormalized,
      enrichment.media_type ?? null,
      enrichment.media_type ?? null,
      enrichment.synopsis ?? null,
      enrichment.image_url ?? null,
      enrichment.release_year ?? null,
      JSON.stringify(externalIds),
      JSON.stringify(metadata),
      JSON.stringify(availability),
      itemId,
    )
    .run();
  return itemId;
}

async function getItemById(env: Env, itemId: number, userId?: number): Promise<ItemRow | null> {
  if (userId !== undefined) {
    return await env.DB.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").bind(itemId, userId).first<ItemRow>();
  }
  return await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(itemId).first<ItemRow>();
}

async function findItemByIdentity(env: Env, normalizedTitle: string, mediaType: MediaType, excludeId?: number, userId?: number): Promise<ItemRow | null> {
  const conditions = ["normalized_title = ?", "media_type = ?"];
  const binds: unknown[] = [normalizedTitle, mediaType];
  if (excludeId !== undefined) {
    conditions.push("id != ?");
    binds.push(excludeId);
  }
  if (userId !== undefined) {
    conditions.push("user_id = ?");
    binds.push(userId);
  }
  const sql = `SELECT * FROM items WHERE ${conditions.join(" AND ")} LIMIT 1`;
  return await env.DB.prepare(sql).bind(...binds).first<ItemRow>();
}

async function findReusableItemForUpsert(env: Env, normalizedTitle: string, mediaType: MediaType, userId?: number): Promise<ItemRow | null> {
  const userIdClause = userId !== undefined ? " AND user_id = ?" : "";
  if (mediaType === "unknown") {
    const sql = `SELECT * FROM items WHERE normalized_title = ?${userIdClause} ORDER BY updated_at DESC LIMIT 1`;
    return userId !== undefined
      ? await env.DB.prepare(sql).bind(normalizedTitle, userId).first<ItemRow>()
      : await env.DB.prepare(sql).bind(normalizedTitle).first<ItemRow>();
  }
  const sql = `SELECT * FROM items WHERE normalized_title = ? AND media_type = 'unknown'${userIdClause} LIMIT 1`;
  return userId !== undefined
    ? await env.DB.prepare(sql).bind(normalizedTitle, userId).first<ItemRow>()
    : await env.DB.prepare(sql).bind(normalizedTitle).first<ItemRow>();
}

async function deleteItem(env: Env, itemId: number, userId?: number): Promise<void> {
  const item = await getItemById(env, itemId, userId);
  if (!item) return;
  await env.DB.prepare(
    "UPDATE raw_captures SET processed_status = 'deleted' WHERE id IN (SELECT raw_capture_id FROM item_sources WHERE item_id = ?)",
  )
    .bind(itemId)
    .run();
  await env.DB.prepare("DELETE FROM item_sources WHERE item_id = ?").bind(itemId).run();
  await env.DB.prepare("DELETE FROM personal_signals WHERE item_id = ?").bind(itemId).run();
  await env.DB.prepare("DELETE FROM enrichment_runs WHERE item_id = ?").bind(itemId).run();
  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(itemId).run();
}

async function renameItem(env: Env, itemId: number, title: string, userId?: number): Promise<void> {
  const item = await getItemById(env, itemId, userId);
  if (!item) return;
  await env.DB.prepare(
    "UPDATE items SET title = ?, normalized_title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(title, itemIdentity(item, title), itemId)
    .run();
}

async function setItemType(env: Env, itemId: number, mediaType: MediaType, userId?: number): Promise<void> {
  const item = await getItemById(env, itemId, userId);
  if (!item) return;
  await env.DB.prepare(
    "UPDATE items SET media_type = ?, normalized_title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(mediaType, itemIdentity(item, item.title, mediaType), itemId)
    .run();
}

async function mergeItems(env: Env, keepItemId: number, removeItemId: number): Promise<void> {
  await env.DB.prepare("UPDATE item_sources SET item_id = ? WHERE item_id = ?").bind(keepItemId, removeItemId).run();
  await env.DB.prepare("UPDATE personal_signals SET item_id = ? WHERE item_id = ?").bind(keepItemId, removeItemId).run();
  await env.DB.prepare("UPDATE enrichment_runs SET item_id = ? WHERE item_id = ?").bind(keepItemId, removeItemId).run();
  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(removeItemId).run();
  await env.DB.prepare("UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(keepItemId).run();
}

async function listItems(env: Env, limit: number, status?: string, mediaType?: MediaType, userId?: number): Promise<ItemRow[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (userId !== undefined) {
    clauses.push("user_id = ?");
    values.push(userId);
  }
  if (status) {
    clauses.push("status = ?");
    values.push(status);
  }
  if (mediaType) {
    clauses.push("media_type = ?");
    values.push(mediaType);
  }
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.DB.prepare(`SELECT * FROM items ${where} ORDER BY updated_at DESC LIMIT ?`)
    .bind(...values)
    .all<ItemRow>();
  return result.results ?? [];
}

async function stats(env: Env, userId?: number): Promise<Record<string, unknown>> {
  const rawCaptures = await count(env, "raw_captures", userId);
  const items = await count(env, "items", userId);
  const enrichmentRuns = userId !== undefined
    ? await env.DB.prepare("SELECT COUNT(*) AS c FROM enrichment_runs er JOIN items i ON er.item_id = i.id WHERE i.user_id = ?").bind(userId).first<{ c: number }>()
    : await env.DB.prepare("SELECT COUNT(*) AS c FROM enrichment_runs").first<{ c: number }>();
  const failedRuns = userId !== undefined
    ? await env.DB.prepare("SELECT COUNT(*) AS c FROM enrichment_runs er JOIN items i ON er.item_id = i.id WHERE er.status = 'failed' AND i.user_id = ?").bind(userId).first<{ c: number }>()
    : await env.DB.prepare("SELECT COUNT(*) AS c FROM enrichment_runs WHERE status = 'failed'").first<{ c: number }>();
  return {
    totals: { raw_captures: rawCaptures, items, enrichment_runs: enrichmentRuns },
    items_by_type: await groupedCounts(env, "media_type", userId),
    items_by_status: await groupedCounts(env, "status", userId),
    failed_enrichment_runs: failedRuns?.c ?? 0,
  };
}

async function count(env: Env, table: string, userId?: number): Promise<number> {
  if (userId !== undefined) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?`).bind(userId).first<{ c: number }>();
    return row?.c ?? 0;
  }
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return row?.c ?? 0;
}

async function groupedCounts(env: Env, column: "media_type" | "status", userId?: number): Promise<Record<string, number>> {
  const query = userId !== undefined
    ? `SELECT ${column} AS label, COUNT(*) AS c FROM items WHERE user_id = ? GROUP BY ${column} ORDER BY ${column}`
    : `SELECT ${column} AS label, COUNT(*) AS c FROM items GROUP BY ${column} ORDER BY ${column}`;
  const result = userId !== undefined
    ? await env.DB.prepare(query).bind(userId).all<{ label: string; c: number }>()
    : await env.DB.prepare(query).all<{ label: string; c: number }>();
  const counts: Record<string, number> = {};
  for (const row of result.results ?? []) counts[row.label] = row.c;
  return counts;
}

function heuristicExtract(text: string): Extraction {
  const lower = text.toLowerCase();
  let media_type: MediaType = "unknown";
  if (isPostUrl(firstUrl(text))) media_type = "post";
  else if (/\bmusic\.youtube\b/.test(lower) || /\b(song|track|album|artist|songs|tracks|albums|artists)\b/.test(lower)) media_type = "song";
  else if (/\b(?:youtube|youtu\.be)\b/.test(lower)) media_type = "youtube";
  else if (/\b(books?|novel|authors?|read)\b/.test(lower)) media_type = "book";
  else if (/\b(podcasts?|episodes?)\b/.test(lower)) media_type = "podcast";
  else if (/\b(series|seasons?)\b/.test(lower)) media_type = "series";
  else if (/\b(movies?|films?|watch)\b/.test(lower)) media_type = "movie";

  return {
    title: heuristicTitleFor(text),
    media_type,
    source_name: guessSource(text),
    source_url: firstUrl(text),
    reason_saved: null,
    confidence: media_type === "unknown" ? 0.4 : 0.55,
    needs_clarification: media_type === "unknown",
  };
}

function coerceExtraction(data: Record<string, unknown>, text: string): Extraction {
  const rawType = String(data.media_type ?? "unknown").toLowerCase();
  let mediaType = MEDIA_TYPES.has(rawType) ? rawType as MediaType : "unknown";
  const sourceUrl = data.source_url ? String(data.source_url) : firstUrl(text);
  // A link to a single X or Reddit post is a post. Without this, an "unknown"
  // verdict sends it through TMDB/Books/Podcasts enrichment, which cannot
  // possibly match and wastes three provider calls to produce nothing.
  if (mediaType === "unknown" && isPostUrl(sourceUrl)) {
    mediaType = "post";
  }
  const confidence = clamp(Number(data.confidence ?? 0.5), 0, 1);
  return {
    title: trim(String(data.title ?? "")) || heuristicTitleFor(text),
    media_type: mediaType,
    source_name: data.source_name ? String(data.source_name) : guessSource(text),
    source_url: sourceUrl,
    reason_saved: data.reason_saved ? String(data.reason_saved) : null,
    confidence,
    needs_clarification: Boolean(data.needs_clarification ?? confidence < 0.55),
  };
}

function parseSongArtist(title: string): { artist: string | null; songTitle: string | null } {
  const match = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (match) return { artist: match[1].trim(), songTitle: match[2].trim() };
  return { artist: null, songTitle: null };
}

function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/\S+/i)?.[0]?.replace(/[.,)]$/, "") ?? null;
}

function guessSource(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("reddit")) return "reddit";
  if (lower.includes("x.com") || lower.includes(" on x")) return "x";
  if (lower.includes("friend")) return "friend";
  if (lower.includes("youtube")) return "youtube";
  return firstUrl(text) ? "link" : "manual";
}

/**
 * The title from the person's own words, not from the page preview appended to
 * them (buildProcessingText). With nothing but a link, the preview's first line
 * (the page or post title) is the best title there is.
 */
function heuristicTitleFor(processingText: string): string {
  const [own, preview = ""] = processingText.split("\n\nSource preview:\n");
  if (own.replace(/https?:\/\/\S+/gi, "").trim()) return heuristicTitle(own);
  const previewTitle = preview.split("\n").map((line) => line.trim())
    .find((line) => line && !/^(URL|Source|Author|Links to):/i.test(line));
  return previewTitle ? trim(previewTitle) : heuristicTitle(own);
}

function heuristicTitle(text: string): string {
  return trim(
    text
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/^\s*(add|save|watch|read|listen to)\s+/i, "")
      .split(/\b(recommended|from|on reddit|on x|because|saw it|people say)\b/i)[0]
      .replace(/\b(movies?|films?|series|shows?|books?|podcasts?|episodes?|youtube|video)\b/gi, "")
      .replace(/^[\s:.,-]+|[\s:.,-]+$/g, ""),
  ) || text;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function trim(value: string, limit = 160): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 3).trim()}...`;
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isMediaType(value: string): value is MediaType {
  return MEDIA_TYPES.has(value);
}

function scoreItem(item: ItemRow, short: boolean): number {
  const metadata = parseJson(item.metadata_json);
  let score = { started: 6, interested: 5, inbox: 3 }[item.status] ?? 0;
  const rating = Number(metadata.rating ?? metadata.average_rating ?? 0);
  if (Number.isFinite(rating)) score += rating / 2;
  if (short) {
    if (item.media_type === "movie" && Number(metadata.runtime ?? 999) <= 120) score += 5;
    if (item.media_type === "series" && Number(metadata.number_of_seasons ?? 99) <= 1) score += 5;
    if (item.media_type === "book" && Number(metadata.page_count ?? 999) <= 250) score += 5;
  }
  return score;
}

/**
 * Parses a JSON request body, or returns an empty object when it is not JSON.
 *
 * request.json() throws on an empty or malformed body, and the top-level catch
 * turned that into a 500 "internal_error". Every caller already validates the
 * fields it needs, so an empty object produces the right 400 instead.
 */
/** A trimmed string field from a parsed body, or "" for anything else. */
function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readJson<T extends object>(request: Request): Promise<Partial<T>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Partial<T> : {};
  } catch {
    return {};
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pngResponse(dataUri: string): Response {
  const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
