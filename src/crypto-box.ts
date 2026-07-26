/**
 * Passphrase-based field encryption for config sync.
 *
 * Config sync uploads this plugin's `data.json` to Google Drive. That file holds
 * the OAuth credentials (`clientId`/`clientSecret`/`refreshToken`), which must
 * never travel in the clear. We AES-GCM encrypt those individual fields with a
 * key derived from a user-supplied passphrase (PBKDF2). The passphrase is
 * entered per device and NEVER synced — so even someone with access to the Drive
 * folder cannot read the credentials.
 *
 * Uses WebCrypto (`crypto.subtle` + `crypto.getRandomValues`), which is
 * available on both desktop and Obsidian mobile (same precedent as the PKCE
 * challenge in `oauth.ts`). No Node `crypto`, so it works on mobile.
 */

/** PBKDF2 iteration count. High enough to be costly to brute-force. */
const PBKDF2_ITERATIONS = 210_000;
/** Salt length in bytes. */
const SALT_BYTES = 16;
/** AES-GCM IV length in bytes (96-bit, the GCM standard). */
const IV_BYTES = 12;

/**
 * A single encrypted value. All three parts are base64 (standard, padded), so
 * the box is JSON-serializable and survives a round-trip through `data.json`.
 */
export interface EncBox {
  salt: string;
  iv: string;
  ct: string;
}

/**
 * Sentinel wrapper written in place of a plaintext field in the uploaded
 * `data.json`. The `__enc` marker lets the download path recognize and decrypt
 * it, and lets tests assert that no plaintext credential leaked.
 */
export interface EncSentinel {
  __enc: EncBox;
}

/** Type guard for the `{ __enc: ... }` sentinel. */
export function isEncSentinel(v: unknown): v is EncSentinel {
  if (typeof v !== "object" || v === null) return false;
  const box = (v as { __enc?: unknown }).__enc;
  if (typeof box !== "object" || box === null) return false;
  const b = box as Record<string, unknown>;
  return (
    typeof b.salt === "string" &&
    typeof b.iv === "string" &&
    typeof b.ct === "string"
  );
}

/** Standard base64 (padded) of a byte array — JSON-safe. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Inverse of `toBase64`. */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Derives an AES-GCM key from a passphrase + salt via PBKDF2 (SHA-256). */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a UTF-8 string with a fresh random salt + IV, returning a
 * JSON-serializable `EncBox`.
 */
export async function encryptString(
  plaintext: string,
  passphrase: string
): Promise<EncBox> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ctBuf)),
  };
}

/**
 * Decrypts an `EncBox` back to its UTF-8 string. Throws if the passphrase is
 * wrong (the GCM authentication tag fails to verify) or the box is corrupt.
 */
export async function decryptString(
  box: EncBox,
  passphrase: string
): Promise<string> {
  const salt = fromBase64(box.salt);
  const iv = fromBase64(box.iv);
  const ct = fromBase64(box.ct);
  const key = await deriveKey(passphrase, salt);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource
  );
  return new TextDecoder().decode(ptBuf);
}

/** Encrypts a value into the `{ __enc: ... }` sentinel form. */
export async function encryptSentinel(
  plaintext: string,
  passphrase: string
): Promise<EncSentinel> {
  return { __enc: await encryptString(plaintext, passphrase) };
}

/** Decrypts a `{ __enc: ... }` sentinel back to its plaintext string. */
export async function decryptSentinel(
  sentinel: EncSentinel,
  passphrase: string
): Promise<string> {
  return decryptString(sentinel.__enc, passphrase);
}

// --- Device-local passphrase obfuscation ---------------------------------
//
// So config sync can run UNATTENDED (auto-sync), the passphrase is stored on the
// device rather than re-prompted every session. It is stored OBFUSCATED, not in
// the clear — encrypted under a key derived from a device-stable value
// (`deviceKey`, e.g. vault path + plugin id + a fixed app salt).
//
// ⚠️ This is OBFUSCATION, NOT protection: the de-obfuscation key lives on the
// same device as the ciphertext, so anyone with local file access can reverse
// it. What it DOES achieve: (1) the passphrase is not plaintext at rest, so a
// copied/synced/screenshotted data.json doesn't leak it verbatim; (2) it is
// bound to THIS device — a data.json copied elsewhere won't de-obfuscate, so it
// reads as "no passphrase set" there; (3) the passphrase still NEVER goes to
// Drive, so a Drive-only leak still cannot decrypt the credentials.

/** Fewer PBKDF2 rounds than real encryption — this is only obfuscation. */
const OBF_ITERATIONS = 10_000;

/** Obfuscates a passphrase for at-rest storage, bound to `deviceKey`. */
export async function obfuscatePassphrase(
  passphrase: string,
  deviceKey: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveObfKey(deviceKey, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(passphrase)
  );
  // Pack salt|iv|ct into a single base64 string for a compact settings field.
  return toBase64(concat(salt, iv, new Uint8Array(ct)));
}

/**
 * De-obfuscates a stored passphrase. Returns null if it cannot be decoded with
 * this device's key (e.g. the data.json was copied from another device) — the
 * caller then treats it as "no passphrase set".
 */
export async function deobfuscatePassphrase(
  stored: string,
  deviceKey: string
): Promise<string | null> {
  try {
    const bytes = fromBase64(stored);
    const salt = bytes.slice(0, SALT_BYTES);
    const iv = bytes.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
    const ct = bytes.slice(SALT_BYTES + IV_BYTES);
    const key = await deriveObfKey(deviceKey, salt);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** PBKDF2 key from the device-stable value (low iterations — obfuscation only). */
async function deriveObfKey(
  deviceKey: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(deviceKey),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: OBF_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Concatenates byte arrays. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * A known constant encrypted under the passphrase and stored in Drive so a
 * device can verify a pasted passphrase up front (before a run writes anything).
 */
export const VERIFIER_PLAINTEXT = "obsidian-gdrive-config-sync:v1";

/** Builds a verifier box from the passphrase (encrypts the known constant). */
export async function makeVerifier(passphrase: string): Promise<EncBox> {
  return encryptString(VERIFIER_PLAINTEXT, passphrase);
}

/**
 * Returns true iff `passphrase` decrypts `verifier` to the known constant.
 * Never throws — a wrong passphrase (auth-tag failure) resolves to `false`.
 */
export async function checkVerifier(
  verifier: EncBox,
  passphrase: string
): Promise<boolean> {
  try {
    return (await decryptString(verifier, passphrase)) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}
