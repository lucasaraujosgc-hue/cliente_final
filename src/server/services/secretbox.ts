import crypto from "crypto";

// AES-256-GCM encryption for secrets at rest (SERPRO consumer secret, cert
// passphrase, the .pfx bytes).
//
// Key: SECRETS_KEY env var, hashed to 32 bytes so any length works. This is a
// DEDICATED key — never JWT_SECRET. If SECRETS_KEY is unset, encryption is a
// no-op (values stored as-is) and a warning is logged; this keeps the app
// working while the operator sets the key, and decryptSecret still reads the
// old plaintext.
//
// Wire format (string): "enc:v1:<iv b64>:<tag b64>:<ciphertext b64>"

const ENC_PREFIX = "enc:v1:";

function key(): Buffer | null {
  const raw = process.env.SECRETS_KEY;
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function secretsEncryptionEnabled(): boolean {
  return key() !== null;
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  const k = key();
  if (!k) return plain; // no key configured -> store as-is
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [iv, tag, ct].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return stored ?? null;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext
  const k = key();
  if (!k) throw new Error("SECRETS_KEY is required to read an encrypted secret but is not set");
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// Same, for arbitrary bytes (the .pfx certificate file).
const ENC_MAGIC = Buffer.from("ENCv1\0");

export function encryptBytes(plain: Buffer): Buffer {
  const k = key();
  if (!k) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([ENC_MAGIC, iv, cipher.getAuthTag(), ct]);
}

export function decryptBytes(stored: Buffer): Buffer {
  if (stored.length < ENC_MAGIC.length || !stored.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
    return stored; // legacy plaintext file
  }
  const k = key();
  if (!k) throw new Error("SECRETS_KEY is required to read the encrypted certificate but is not set");
  let off = ENC_MAGIC.length;
  const iv = stored.subarray(off, (off += 12));
  const tag = stored.subarray(off, (off += 16));
  const ct = stored.subarray(off);
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
