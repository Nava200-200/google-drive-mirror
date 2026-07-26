import { describe, it, expect } from "vitest";
import {
  encryptString,
  decryptString,
  encryptSentinel,
  decryptSentinel,
  isEncSentinel,
  makeVerifier,
  checkVerifier,
  VERIFIER_PLAINTEXT,
  obfuscatePassphrase,
  deobfuscatePassphrase,
} from "../../src/crypto-box";

describe("crypto-box", () => {
  const pass = "correct horse battery staple";

  it("round-trips a string through encrypt/decrypt", async () => {
    const box = await encryptString("1//super-secret-refresh-token", pass);
    const back = await decryptString(box, pass);
    expect(back).toBe("1//super-secret-refresh-token");
  });

  it("round-trips non-ASCII content", async () => {
    const secret = "clé-secrète-日本語-🔒";
    const box = await encryptString(secret, pass);
    expect(await decryptString(box, pass)).toBe(secret);
  });

  it("produces JSON-serializable base64 fields", async () => {
    const box = await encryptString("x", pass);
    // Survives a JSON round-trip unchanged.
    const revived = JSON.parse(JSON.stringify(box));
    expect(await decryptString(revived, pass)).toBe("x");
    for (const part of [box.salt, box.iv, box.ct]) {
      expect(typeof part).toBe("string");
      expect(part).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    }
  });

  it("uses a fresh salt and IV per encryption (no ciphertext reuse)", async () => {
    const a = await encryptString("same input", pass);
    const b = await encryptString("same input", pass);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("throws on a wrong passphrase (GCM auth-tag failure)", async () => {
    const box = await encryptString("secret", pass);
    await expect(decryptString(box, "wrong passphrase")).rejects.toThrow();
  });

  it("throws on corrupted ciphertext", async () => {
    const box = await encryptString("secret", pass);
    const tampered = { ...box, ct: box.ct.slice(0, -4) + "AAAA" };
    await expect(decryptString(tampered, pass)).rejects.toThrow();
  });

  describe("sentinel", () => {
    it("wraps and unwraps via the __enc form", async () => {
      const s = await encryptSentinel("token", pass);
      expect(s).toHaveProperty("__enc");
      expect(await decryptSentinel(s, pass)).toBe("token");
    });

    it("isEncSentinel recognizes only well-formed sentinels", async () => {
      const s = await encryptSentinel("token", pass);
      expect(isEncSentinel(s)).toBe(true);
      expect(isEncSentinel({ __enc: { salt: "a", iv: "b", ct: "c" } })).toBe(
        true
      );
      expect(isEncSentinel(null)).toBe(false);
      expect(isEncSentinel("string")).toBe(false);
      expect(isEncSentinel({ foo: 1 })).toBe(false);
      expect(isEncSentinel({ __enc: { salt: "a" } })).toBe(false);
      expect(isEncSentinel({ __enc: null })).toBe(false);
    });
  });

  describe("verifier", () => {
    it("accepts the correct passphrase and rejects a wrong one", async () => {
      const v = await makeVerifier(pass);
      expect(await checkVerifier(v, pass)).toBe(true);
      expect(await checkVerifier(v, "nope")).toBe(false);
    });

    it("encrypts the known constant (not stored in the clear)", async () => {
      const v = await makeVerifier(pass);
      expect(v.ct).not.toContain(VERIFIER_PLAINTEXT);
      expect(await decryptString(v, pass)).toBe(VERIFIER_PLAINTEXT);
    });

    it("checkVerifier never throws on garbage input", async () => {
      const bad = { salt: "AAAA", iv: "AAAA", ct: "AAAA" };
      await expect(checkVerifier(bad, pass)).resolves.toBe(false);
    });
  });

  describe("device-local obfuscation", () => {
    const device = "vaultA::google-drive-mirror::app-salt";

    it("round-trips on the same device", async () => {
      const obf = await obfuscatePassphrase(pass, device);
      expect(await deobfuscatePassphrase(obf, device)).toBe(pass);
    });

    it("does not store the passphrase in the clear", async () => {
      const obf = await obfuscatePassphrase("plain-secret", device);
      expect(obf).not.toContain("plain-secret");
    });

    it("returns null on a DIFFERENT device key (copied data.json)", async () => {
      const obf = await obfuscatePassphrase(pass, device);
      const other = "vaultB::google-drive-mirror::app-salt";
      expect(await deobfuscatePassphrase(obf, other)).toBeNull();
    });

    it("returns null on garbage input (never throws)", async () => {
      expect(await deobfuscatePassphrase("not-base64!!", device)).toBeNull();
      expect(await deobfuscatePassphrase("", device)).toBeNull();
    });

    it("uses a fresh salt+iv each time (different ciphertext)", async () => {
      const a = await obfuscatePassphrase(pass, device);
      const b = await obfuscatePassphrase(pass, device);
      expect(a).not.toBe(b);
      // Both still decode.
      expect(await deobfuscatePassphrase(a, device)).toBe(pass);
      expect(await deobfuscatePassphrase(b, device)).toBe(pass);
    });
  });
});
