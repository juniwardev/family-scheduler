// Regression test for the VAPID `Invalid PKCS8 input` production defect
// (docs/plans/push-crypto-fix.md, fix #1).
//
// Root cause: `signVapidJwt` imported the raw 32-byte P-256 private scalar
// (the format `web-push generate-vapid-keys` actually produces) via
// `crypto.subtle.importKey("pkcs8", ...)`, which expects a full ASN.1/DER
// PrivateKeyInfo structure, not a bare scalar. That threw
// `DataError: Invalid PKCS8 input` on every production cron tick.
//
// The fix builds a JWK `{ kty: 'EC', crv: 'P-256', d, x, y, ext: true }` from
// the raw material already held in env (VAPID_PUBLIC_KEY gives x/y,
// VAPID_PRIVATE_KEY gives d) and imports via `importKey("jwk", ...)`.
//
// This test runs under @cloudflare/vitest-pool-workers (real workerd
// crypto.subtle, not a mock) — the same runtime gap that let the bug ship
// undetected. It uses a locally generated TEST-ONLY VAPID keypair, never the
// production secret.

import { describe, it, expect } from "vitest";
import { signVapidJwt } from "../../src/worker/channels/push";
import type { Env } from "../../src/worker/env";

// Test-only VAPID keypair (P-256), generated locally with Node's crypto —
// NOT the production key. See docs/plans/push-crypto-fix.md §7 step 5.
const TEST_VAPID_PUBLIC_KEY =
  "BG6wcYaRgf2SoAFYKg6_-YBvcl3KoGmtbfgaxIM3yLVtbZ9zktg1NVB8nqg4J07CZPZJZeuihS7axxJ-1DCrgpA";
const TEST_VAPID_PRIVATE_KEY = "CZwJtOhO5m_8h09WdpTuLDCOhA1S2nYV35DO285sKis";

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function b64urlToJson(s: string): unknown {
  const bytes = b64urlToBytes(s);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return JSON.parse(str);
}

function buildFakeEnv(): Env {
  return {
    ASSETS: {} as Fetcher,
    DB: {} as D1Database,
    ATTACHMENTS: {} as R2Bucket,
    ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    ACCESS_AUD: "test-aud",
    OWNER_EMAIL: "owner@example.com",
    VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
    VAPID_SUBJECT: "mailto:owner@example.com",
    EMAIL_FROM: "Family Scheduler <reminders@example.com>",
    APP_URL: "https://app.example.com",
    RESEND_API_KEY: "test-resend-key",
    VAPID_PRIVATE_KEY: TEST_VAPID_PRIVATE_KEY,
  };
}

describe("signVapidJwt — JWK import fix (push-crypto-fix)", () => {
  it("the raw key material has the expected shapes (sanity check on test fixtures)", () => {
    const pubBytes = b64urlToBytes(TEST_VAPID_PUBLIC_KEY);
    const privBytes = b64urlToBytes(TEST_VAPID_PRIVATE_KEY);

    // Uncompressed P-256 point: 0x04 || X(32) || Y(32) = 65 bytes.
    expect(pubBytes.length).toBe(65);
    expect(pubBytes[0]).toBe(0x04);
    // Raw scalar d: 32 bytes.
    expect(privBytes.length).toBe(32);
  });

  it("signs a VAPID JWT without throwing, using the JWK import path", async () => {
    const env = buildFakeEnv();
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

    // Before the fix this threw `DataError: Invalid PKCS8 input`.
    const jwt = await signVapidJwt(endpoint, env);

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const [headerB64, payloadB64] = parts;

    const header = b64urlToJson(headerB64) as { typ: string; alg: string };
    expect(header.typ).toBe("JWT");
    expect(header.alg).toBe("ES256");

    const payload = b64urlToJson(payloadB64) as {
      aud: string;
      exp: number;
      sub: string;
    };
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe(env.VAPID_SUBJECT);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("produces a signature that verifies against the published public key (mirrors the k= server contract)", async () => {
    const env = buildFakeEnv();
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

    const jwt = await signVapidJwt(endpoint, env);
    const [headerB64, payloadB64, sigB64] = jwt.split(".");

    const sigInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig = b64urlToBytes(sigB64);

    // Import the public key exactly as the wire contract does: raw
    // uncompressed point, mirroring `Authorization: vapid t=...,k=<pub>`.
    const pubBytes = b64urlToBytes(env.VAPID_PUBLIC_KEY);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      pubBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sig,
      sigInput
    );

    expect(verified).toBe(true);
  });
});
