// auth.ts — Cloudflare Access JWT verification
// Verifies the Cf-Access-Jwt-Assertion header on every /api request.
// Never trusts Cf-Access-Authenticated-User-Email alone (spec §13).

import { createMiddleware } from "hono/factory";
import type { Env } from "./env";
import type { User } from "./types";
import type { Result } from "./types";
import { upsertUser } from "./db";

export interface AccessIdentity {
  email: string;
}

// In-memory JWKS cache keyed by kid, best-effort per isolate.
// Short TTL (10 min) to pick up key rotations.
let jwksCache: { keys: JsonWebKey[]; expiresAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

export async function getAccessKeys(env: Env): Promise<JsonWebKey[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const url = `${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch JWKS: ${resp.status}`);

  const data = (await resp.json()) as { keys: JsonWebKey[] };
  jwksCache = { keys: data.keys, expiresAt: now + JWKS_TTL_MS };
  return data.keys;
}

/**
 * Decode a base64url string to an ArrayBuffer.
 */
function base64urlDecode(s: string): ArrayBuffer {
  // Replace base64url chars with standard base64
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Parse a JWT without verifying it, returning { header, payload, sigInput, sigBytes }.
 */
function parseJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  sigInput: Uint8Array;
  sigBytes: ArrayBuffer;
} {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
  const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  const sigInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sigBytes = base64urlDecode(parts[2]);

  return { header, payload, sigInput, sigBytes };
}

/**
 * Verify a Cloudflare Access JWT against the team's JWKS.
 * Checks: RS256 signature, aud claim, iss claim, exp.
 */
export async function verifyAccessJwt(
  token: string,
  env: Env,
  now?: number
): Promise<Result<AccessIdentity>> {
  const ts = now ?? Date.now();

  let parsed: ReturnType<typeof parseJwt>;
  try {
    parsed = parseJwt(token);
  } catch {
    return { ok: false, code: "VALIDATION", message: "Malformed JWT" };
  }

  const { header, payload, sigInput, sigBytes } = parsed;

  // Check expiry
  if (typeof payload.exp !== "number" || payload.exp * 1000 < ts) {
    return { ok: false, code: "VALIDATION", message: "JWT expired" };
  }

  // Check aud
  const aud = payload.aud;
  const audMatch = Array.isArray(aud)
    ? aud.includes(env.ACCESS_AUD)
    : aud === env.ACCESS_AUD;
  if (!audMatch) {
    return { ok: false, code: "VALIDATION", message: "JWT aud mismatch" };
  }

  // Check iss
  if (payload.iss !== env.ACCESS_TEAM_DOMAIN) {
    return { ok: false, code: "VALIDATION", message: "JWT iss mismatch" };
  }

  // Extract email
  const email = payload.email;
  if (typeof email !== "string" || !email) {
    return { ok: false, code: "VALIDATION", message: "JWT missing email claim" };
  }

  // Verify signature using the matching key (by kid)
  let keys: JsonWebKey[];
  try {
    keys = await getAccessKeys(env);
  } catch {
    return { ok: false, code: "INTERNAL", message: "Failed to fetch JWKS" };
  }

  const kid = header.kid as string | undefined;
  const candidates = kid ? keys.filter((k) => (k as { kid?: string }).kid === kid) : keys;
  if (candidates.length === 0) {
    return { ok: false, code: "VALIDATION", message: "No matching JWKS key" };
  }

  for (const jwk of candidates) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        sigBytes,
        sigInput
      );
      if (valid) return { ok: true, value: { email: email.toLowerCase() } };
    } catch {
      // Try next key
    }
  }

  return { ok: false, code: "VALIDATION", message: "JWT signature invalid" };
}

// Hono context type extension
type Variables = {
  user: User;
};

/**
 * SECURITY GATE (the sole load-bearing signal for the local-only dev auth shim).
 * Pure; request-only. Cloudflare routes inbound traffic to the deployed Worker by
 * hostname, so a request whose hostname is a loopback literal is never dispatched
 * to the deployed Worker — this is un-forgeable in production. `wrangler dev`
 * reliably serves on one of these loopback hosts. Any URL parse failure fails
 * closed (returns false), never open. See docs/plans/dev-auth-shim.md §3.1/§3.4.
 */
export function isLocalDevContext(request: Request): boolean {
  let host: string;
  try {
    host = new URL(request.url).hostname;
  } catch {
    return false; // any URL/hostname parse error → fail closed
  }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Resolves the local-dev shim identity. The `DEV_AUTH_IDENTITY` sentinel is a
 * NON-security on/off toggle + identity selector — it is read ONLY after the
 * un-forgeable loopback-host gate above has already passed, so it can never
 * re-open the gate (even if misconfigured as a deployed secret).
 */
export function resolveDevIdentity(env: Env, request: Request): string | null {
  if (!isLocalDevContext(request)) return null; // SECURITY GATE first → fail closed
  const sel = env.DEV_AUTH_IDENTITY; // read ONLY inside the gated branch (non-security)
  if (!sel) return null; // toggle OFF (unset/empty) → real path runs
  // Lowercase BOTH branches for parity with the real path (auth.ts:142).
  const email = sel.includes("@") ? sel : env.OWNER_EMAIL;
  return email.toLowerCase();
}

/**
 * requireAuth middleware. Strict ordering per D14:
 *   1. Verify the Access JWT (signature, aud, iss, exp) → 401 UNAUTHENTICATED if missing/invalid.
 *   2. Resolve/upsert the user (includes OWNER_EMAIL promotion — O1/N5, always seeded active+admin).
 *   3. Check user.active → 403 DEACTIVATED if active === false (account deactivated).
 *   4. Else c.set('user', User) and proceed.
 *
 * The active check runs after upsert so the owner is never gated (they are always seeded
 * active=1 by upsertUser). Because this middleware is registered globally on /api/* before
 * any route handler, the DEACTIVATED 403 applies uniformly to ALL /api/* routes with no
 * per-route changes needed. The requireAdmin middleware (which checks role=admin) only runs
 * after requireAuth (guaranteed by mount order in index.ts).
 */
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    // Local-only dev auth shim (docs/plans/dev-auth-shim.md). Activates ONLY when
    // isLocalDevContext(c.req.raw) is true (loopback request hostname — the sole
    // production-safety gate) AND DEV_AUTH_IDENTITY is set. Any other case falls
    // through unchanged to the real Cf-Access-Jwt-Assertion + verifyAccessJwt path
    // below. The shim substitutes only the identity SOURCE: it feeds the same
    // upsertUser + D14 active-gate + c.set("user", ...) path the real flow uses.
    const devIdentity = resolveDevIdentity(c.env, c.req.raw);
    if (devIdentity) {
      // One-time activation log (email only, never secrets/JWTs). Its absence in
      // deployed logs is a passive tripwire — if this line ever appears in
      // production logs, the gate has been breached.
      console.warn(`[dev-auth] shim active as ${devIdentity}`);

      const devUser = await upsertUser(c.env.DB, devIdentity, c.env.OWNER_EMAIL, Date.now());

      // D14: same active-access gate as the real path (see below).
      if (!devUser.active) {
        return c.json(
          { error: { code: "DEACTIVATED", message: "Account deactivated" } },
          403
        );
      }

      c.set("user", devUser);
      await next();
      return;
    }

    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "Missing Access JWT" } },
        401
      );
    }

    const result = await verifyAccessJwt(token, c.env);
    if (!result.ok) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: result.message } },
        401
      );
    }

    const user = await upsertUser(
      c.env.DB,
      result.value.email,
      c.env.OWNER_EMAIL,
      Date.now()
    );

    // D14: enforce app-level access gate after upsert so the owner is always seeded
    // active+admin first (via upsertUser) and can never be blocked by this check.
    // Combined with the self-deactivation guard in setUserActive, the sole admin
    // cannot 403-lock themselves out of the admin panel.
    if (!user.active) {
      return c.json(
        { error: { code: "DEACTIVATED", message: "Account deactivated" } },
        403
      );
    }

    c.set("user", user);
    await next();
  }
);

/**
 * requireAdmin middleware: must run AFTER requireAuth (guaranteed by mount order — see index.ts).
 * Returns 403 if the user's role !== 'admin'.
 */
export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const user = c.get("user");
    if (!user || user.role !== "admin") {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Admin access required" } },
        403
      );
    }
    await next();
  }
);
