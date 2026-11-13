// Regression test for the aes128gcm HKDF `info` double-null defect found
// during adversarial plan review (docs/plans/push-crypto-fix.md, fix #2).
//
// Root cause: `encryptPayload` built the HKDF `info` for the CEK and nonce
// derivations as `concatBytes(enc.encode("Content-Encoding: ...\0"),
// new Uint8Array(1))` — the string literal already ends in one `0x00`, and
// the extra `new Uint8Array(1)` appended a SECOND `0x00`. Per RFC 8188 §2.2
// the info must end in exactly one trailing `0x00` (WebCrypto's HKDF
// deriveBits appends the `0x01` counter byte internally per RFC 5869). The
// double-null derived the wrong CEK/nonce, so a real push service would
// return 201 Created while the browser silently failed to decrypt and no
// notification ever appeared.
//
// This test is a deterministic proxy for that failure mode: it encrypts with
// the production `encryptPayload` function, then decrypts on a simulated
// recipient side, independently re-deriving the CEK/nonce using the CORRECT
// single-`0x00` info strings (hardcoded here, not imported from push.ts, per
// plan review note P2-2 — this keeps the asymmetry meaningful as a
// regression guard). Because encrypt (production) and decrypt (this test)
// derive from independently-written info bytes, the test FAILS against the
// buggy double-null encrypt and PASSES once the fix is applied.
//
// Runs under @cloudflare/vitest-pool-workers (real workerd crypto.subtle).

import { describe, it, expect } from "vitest";
import { encryptPayload } from "../../src/worker/channels/push";

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

describe("encryptPayload — HKDF info double-null fix (push-crypto-fix)", () => {
  it("round-trips: encrypt (production) -> decrypt (independently re-derived) recovers the plaintext", async () => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    // --- Recipient side: generate the "subscription" ECDH keypair + auth secret ---
    const recipientPair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    )) as CryptoKeyPair;

    const recipientPublicKeyBytes = new Uint8Array(
      (await crypto.subtle.exportKey("raw", recipientPair.publicKey)) as ArrayBuffer
    );
    const p256dh = bytesToB64url(recipientPublicKeyBytes);

    const authBytes = crypto.getRandomValues(new Uint8Array(16));
    const auth = bytesToB64url(authBytes);

    // --- Production encrypt path (the code under fix) ---
    const plaintextPayload = JSON.stringify({ title: "t", body: "b" });
    const encrypted = await encryptPayload(plaintextPayload, p256dh, auth);

    // --- Recipient-side decrypt: re-derive shared secret via ECDH ---
    const serverPublicKey = await crypto.subtle.importKey(
      "raw",
      encrypted.serverPublicKeyBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );

    type HkdfAlgo = Parameters<typeof crypto.subtle.deriveBits>[0];

    const sharedSecretBuf = await crypto.subtle.deriveBits(
      { name: "ECDH", public: serverPublicKey } as unknown as HkdfAlgo,
      recipientPair.privateKey,
      256
    );
    const sharedSecret = new Uint8Array(sharedSecretBuf);

    // --- HKDF-extract: PRK from auth secret + shared secret + context (RFC 8291 §3.4) ---
    // Hardcoded independently of push.ts — NOT imported — so this test stays
    // a meaningful regression guard (plan review note P2-2).
    const infoBytes = concatBytes(
      enc.encode("WebPush: info\0"),
      recipientPublicKeyBytes,
      encrypted.serverPublicKeyBytes
    );

    const prkKeyMaterial = await crypto.subtle.importKey(
      "raw",
      sharedSecret,
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

    // --- HKDF: derive CEK (128 bits) and nonce (96 bits) using the CORRECT
    // single-trailing-0x00 info strings (RFC 8188 §2.2). ---
    const cekInfo = enc.encode("Content-Encoding: aes128gcm\0");
    const nonceInfo = enc.encode("Content-Encoding: nonce\0");

    // Sanity: exact byte layout from the plan (§3.5), confirming this test
    // is checking against the RFC-correct single-null info, not a mock of
    // the (buggy) double-null production code.
    expect(cekInfo.length).toBe(28);
    expect(nonceInfo.length).toBe(24);
    expect(cekInfo[cekInfo.length - 1]).toBe(0x00);
    expect(nonceInfo[nonceInfo.length - 1]).toBe(0x00);

    const prkMaterial1 = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
    const cekBits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: encrypted.salt, info: cekInfo } as unknown as HkdfAlgo,
      prkMaterial1,
      128
    );

    const prkMaterial2 = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
    const nonceBits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: encrypted.salt, info: nonceInfo } as unknown as HkdfAlgo,
      prkMaterial2,
      96
    );

    const cekKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(cekBits),
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const nonce = new Uint8Array(nonceBits);

    // --- AES-GCM decrypt ---
    const plaintextWithDelimiterBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      cekKey,
      encrypted.ciphertext
    );
    const plaintextWithDelimiter = new Uint8Array(plaintextWithDelimiterBuf);

    // Plaintext is payload || 0x02 record delimiter (RFC 8188).
    expect(plaintextWithDelimiter[plaintextWithDelimiter.length - 1]).toBe(0x02);
    const plaintextBytes = plaintextWithDelimiter.slice(0, -1);
    const decodedPayload = dec.decode(plaintextBytes);

    expect(decodedPayload).toBe(plaintextPayload);
    expect(JSON.parse(decodedPayload)).toEqual({ title: "t", body: "b" });
  });
});
