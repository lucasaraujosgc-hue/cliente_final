import bcrypt from "bcryptjs";

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

// Hashes a plaintext password for storage. Always use this before writing
// to the `passwordHash` column.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// Verifies a plaintext password against whatever is stored in the DB.
//
// Historically this app stored passwords as plaintext (e.g. the client's
// own CNPJ) directly in the `passwordHash` column. To upgrade existing
// accounts without forcing a mass password reset, this function:
//  1. If the stored value looks like a bcrypt hash, compares normally.
//  2. Otherwise, falls back to a plain string comparison (old behavior)
//     and, on success, tells the caller to re-hash and persist the
//     password so the account is upgraded the next time it's used.
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (BCRYPT_HASH_RE.test(stored)) {
    const valid = await bcrypt.compare(plain, stored);
    return { valid, needsRehash: false };
  }

  // Legacy plaintext account. Preserve the previous comparison behavior
  // (exact match OR match after stripping non-digits, since some flows
  // stored/compared CNPJ-derived passwords inconsistently).
  const valid =
    stored === plain || stored.replace(/\D/g, "") === plain.replace(/\D/g, "");
  return { valid, needsRehash: valid };
}
