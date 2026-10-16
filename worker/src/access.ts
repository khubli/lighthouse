/**
 * Cloudflare Access identity.
 *
 * When Cloudflare Access sits in front of the Worker, it signs in each person
 * (a code sent to their email, or Google) before a request ever reaches us,
 * and adds a signed token saying who they are. That makes Access a better
 * answer to "which of us is this?" than a PIN: nobody else can reach the app
 * at all, there is nothing to remember, and the email picks the list.
 *
 * The token is trusted only after checking it properly, as Cloudflare's docs
 * require: an RS256 signature by one of the team's published keys, the
 * team's issuer, this application's audience tag, and the expiry. A request
 * that reaches the Worker some other way (a route Access doesn't cover, a
 * hand-made header) has no valid token and is refused.
 *
 * Turned on by two settings, both shown by the dashboard when Access is
 * enabled on the Worker: TEAM_DOMAIN and POLICY_AUD. Without them the Worker
 * uses its own PIN sign-in, as before.
 */

export interface AccessSettings {
  /** e.g. https://yourteam.cloudflareaccess.com, no trailing slash. */
  teamDomain: string;
  /** The Access application's audience (AUD) tag. */
  audience: string;
}

export function accessSettings(env: { TEAM_DOMAIN?: string; POLICY_AUD?: string }): AccessSettings | null {
  const team = env.TEAM_DOMAIN?.trim();
  const audience = env.POLICY_AUD?.trim();
  if (!team || !audience) return null;
  // People paste the domain with or without the scheme; the token's issuer
  // always has it.
  const withScheme = /^https?:\/\//i.test(team) ? team : `https://${team}`;
  return { teamDomain: withScheme.replace(/\/+$/, ""), audience };
}

interface RsaJwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

// Signing keys, cached per isolate. Access rotates them every few weeks and
// publishes the next key ahead of use, so an hour is plenty; an unknown key id
// forces one early refresh, at most once a minute so forged tokens with random
// key ids can't turn into a stream of requests to Cloudflare.
const KEY_TTL_MS = 60 * 60 * 1000;
const FORCED_REFRESH_GAP_MS = 60 * 1000;
let keyCache: { domain: string; keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
let lastForcedRefresh = 0;

async function signingKeys(domain: string, force: boolean): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (keyCache && keyCache.domain === domain && !force && now - keyCache.fetchedAt < KEY_TTL_MS) return keyCache.keys;
  const res = await fetch(`${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access signing keys: HTTP ${res.status}`);
  const body = await res.json() as { keys?: RsaJwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== "RSA" || !jwk.kid || !jwk.n || !jwk.e) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    ));
  }
  keyCache = { domain, keys, fetchedAt: now };
  return keys;
}

function base64UrlBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function base64UrlJson(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as Record<string, unknown>;
}

/** Allowed clock difference between Cloudflare and this Worker. */
const LEEWAY_SEC = 60;

/**
 * Returns the verified, lower-cased email from an Access token, or null for a
 * missing, malformed, forged, expired or foreign token. Never throws.
 */
export async function verifyAccessToken(token: string | null, settings: AccessSettings): Promise<{ email: string } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  let signature: Uint8Array;
  try {
    header = base64UrlJson(parts[0]);
    payload = base64UrlJson(parts[1]);
    signature = base64UrlBytes(parts[2]);
  } catch {
    return null;
  }
  // Only RS256: accepting whatever "alg" the token names is the classic way
  // to let a forged token choose its own (or no) verification.
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  let key: CryptoKey | undefined;
  try {
    key = (await signingKeys(settings.teamDomain, false)).get(header.kid);
    if (!key && Date.now() - lastForcedRefresh > FORCED_REFRESH_GAP_MS) {
      lastForcedRefresh = Date.now();
      key = (await signingKeys(settings.teamDomain, true)).get(header.kid);
    }
  } catch (error) {
    // Fail closed: if Cloudflare's keys can't be fetched, nobody is let in.
    console.error("Access signing keys unavailable", error);
    return null;
  }
  if (!key) return null;

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== settings.teamDomain) return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(settings.audience)) return null;
  if (typeof payload.exp !== "number" || payload.exp < now - LEEWAY_SEC) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + LEEWAY_SEC) return null;
  // Service tokens (machine access) carry no email; they have no list here.
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
  return { email: payload.email.trim().toLowerCase() };
}

/** Where Access signs a person out, on whatever hostname it protects. */
export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";
