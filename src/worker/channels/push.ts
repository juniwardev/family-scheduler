// channels/push.ts — Web Push via VAPID + WebCrypto (Decision D2)
// Implements ES256 VAPID JWT signing and aes128gcm payload encryption
// entirely in the Workers runtime using crypto.subtle.
// No Node.js dependencies required (nodejs_compat NOT needed).

import type { Env } from "../env";

export interface WebPushTarget {
  endpoint: string;
  p256dh: string; // base64url-encoded recipient public key
  auth: string; // base64url-encoded auth secret
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  item_id?: string;
}

export interface PushResult {
  ok: boolean;
  statusCode: number;
  gone: boolean; // true if 404/410 (subscription dead) — delete the subscription row
  transient: boolean; // true if error is transient (5xx/network)
}

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function bytesToB64url(buf: Uint8Array): string {
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// VAPID JWT signing (ES256) — D2
// ---------------------------------------------------------------------------

export async function signVapidJwt(endpoint: string, env: Env): Promise<string> {
  const origin = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12h validity

  const enc = new TextEncoder();
  const header = bytesToB64url(
    enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  );
  const payload = bytesToB64url(
    enc.encode(JSON.stringify({ aud: origin, exp, sub: env.VAPID_SUBJECT }))
  );

  const sigInput = enc.encode(`${header}.${payload}`);

  // VAPID keys from `web-push generate-vapid-keys` are RAW base64url:
  //   VAPID_PUBLIC_KEY  = 65-byte uncompressed P-256 point: 0x04 || X(32) || Y(32)
  //   VAPID_PRIVATE_KEY = 32-byte raw scalar d
  // Build a JWK from that raw material rather than treating it as PKCS8 DER.
  // NOTE: the two secrets must be rotated as a matched pair — x/y here come from
  // VAPID_PUBLIC_KEY and must correspond to d from VAPID_PRIVATE_KEY.
  const pubBytes = b64urlToBytes(env.VAPID_PUBLIC_KEY);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY is not a 65-byte uncompressed P-256 point");
  }
  const x = bytesToB64url(pubBytes.slice(1, 33));
  const y = bytesToB64url(pubBytes.slice(33, 65));
  // Normalize d through the project's own decode/encode to guarantee
  // unpadded base64url regardless of how the secret was stored.
  const d = bytesToB64url(b64urlToBytes(env.VAPID_PRIVATE_KEY));

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    sigInput
  );

  return `${header}.${payload}.${bytesToB64url(new Uint8Array(sigBuf))}`;
}

// ---------------------------------------------------------------------------
// aes128gcm payload encryption (RFC 8291) — D2
// ---------------------------------------------------------------------------

export interface EncryptedPayload {
  ciphertext: Uint8Array;
  salt: Uint8Array;
  serverPublicKeyBytes: Uint8Array;
}

export async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string
): Promise<EncryptedPayload> {
  const enc = new TextEncoder();

  const recipientKeyBytes = b64urlToBytes(p256dh);
  const authBytes = b64urlToBytes(auth);

  const recipientPublicKey = await crypto.subtle.importKey(
    "raw",
    recipientKeyBytes, // Uint8Array is BufferSource
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Generate ephemeral ECDH key pair (returns CryptoKeyPair)
  const ephemeralPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  const serverPublicKeyBytes = new Uint8Array(
    // exportKey("raw", ...) returns JsonWebKey | ArrayBuffer; raw format always yields ArrayBuffer
    (await crypto.subtle.exportKey("raw", ephemeralPair.publicKey)) as ArrayBuffer
  );

  // ECDH shared secret (256 bits = 32 bytes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharedSecretBuf = await crypto.subtle.deriveBits(
    // ECDH deriveBits takes { name, public } — cast through unknown to satisfy strict overload checks
    { name: "ECDH", public: recipientPublicKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0],
    ephemeralPair.privateKey,
    256
  );
  const sharedSecret = new Uint8Array(sharedSecretBuf);

  // Random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // --- HKDF: extract PRK from auth secret + shared secret + context ---
  const infoBytes = concatBytes(
    enc.encode("WebPush: info\0"),
    recipientKeyBytes,
    serverPublicKeyBytes
  );

  type HkdfAlgo = Parameters<typeof crypto.subtle.deriveBits>[0];

  const prkKeyMaterial = await crypto.subtle.importKey(
    "raw",
    sharedSecret, // Uint8Array is BufferSource
    "HKDF",
    false,
    ["deriveBits"]
  );

  const prkBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: authBytes, info: infoBytes } as unknown as HkdfAlgo,
    prkKeyMaterial,
    256
  );
  const prk = new Uint8Array(prkBits);

  // --- HKDF: derive CEK (128 bits) and nonce (96 bits) from PRK + salt ---
  const prkMaterial = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);

  const cekInfo = enc.encode("Content-Encoding: aes128gcm\0");
  const cekBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: cekInfo } as unknown as HkdfAlgo,
    prkMaterial,
    128
  );

  // Need fresh key material for nonce derivation (HKDF key can only be used once)
  const prkMaterial2 = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
  const nonceInfo = enc.encode("Content-Encoding: nonce\0");
  const nonceBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo } as unknown as HkdfAlgo,
    prkMaterial2,
    96
  );

  const cekKey = await crypto.subtle.importKey("raw", new Uint8Array(cekBits), "AES-GCM", false, ["encrypt"]);
  const nonce = new Uint8Array(nonceBits);

  // Plaintext: payload + 0x02 record delimiter
  const plaintext = concatBytes(enc.encode(payload), new Uint8Array([2]));

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cekKey,
    plaintext
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuf),
    salt,
    serverPublicKeyBytes,
  };
}

function buildPushBody(enc: EncryptedPayload): Uint8Array {
  const recordSize = 4096;
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, recordSize, false);
  const idlen = new Uint8Array([enc.serverPublicKeyBytes.length]);

  return concatBytes(enc.salt, rsBytes, idlen, enc.serverPublicKeyBytes, enc.ciphertext);
}

// ---------------------------------------------------------------------------
// Public send function
// ---------------------------------------------------------------------------

/**
 * Send a web push notification to a single subscription endpoint.
 * Returns gone=true for 404/410 (dead subscription — caller should delete it).
 */
export async function sendPush(
  target: WebPushTarget,
  payload: PushPayload,
  env: Env
): Promise<PushResult> {
  let vapidJwt: string;
  let encPayload: EncryptedPayload;

  try {
    vapidJwt = await signVapidJwt(target.endpoint, env);
    encPayload = await encryptPayload(JSON.stringify(payload), target.p256dh, target.auth);
  } catch (err) {
    // Crypto failure — treat as transient (retry won't help if keys are wrong,
    // but avoids permanently marking failed due to a config issue)
    console.error("push crypto error:", err);
    return { ok: false, statusCode: 0, gone: false, transient: true };
  }

  const body = buildPushBody(encPayload);

  let resp: Response;
  try {
    resp = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        Authorization: `vapid t=${vapidJwt},k=${env.VAPID_PUBLIC_KEY}`,
        TTL: "86400",
      },
      body,
    });
  } catch {
    // Network error — transient
    return { ok: false, statusCode: 0, gone: false, transient: true };
  }

  const gone = resp.status === 404 || resp.status === 410;
  if (gone) return { ok: false, statusCode: resp.status, gone: true, transient: false };

  if (resp.status >= 200 && resp.status < 300) {
    return { ok: true, statusCode: resp.status, gone: false, transient: false };
  }

  if (resp.status === 429 || resp.status >= 500) {
    return { ok: false, statusCode: resp.status, gone: false, transient: true };
  }

  // Other 4xx — permanent failure
  return { ok: false, statusCode: resp.status, gone: false, transient: false };
}
