// Password hashing (argon2id) and the NIST-style password policy: length
// bounds plus a zxcvbn strength floor instead of composition rules — zxcvbn's
// dictionaries subsume a separate common-password blocklist (see ADR 0006).
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
/** zxcvbn score 0–4; 3 = "safely unguessable" — the policy floor. */
export const PASSWORD_MIN_SCORE = 3;

let zxcvbnReady = false;
function ensureZxcvbn(): void {
  if (zxcvbnReady) return;
  zxcvbnOptions.setOptions({
    translations: zxcvbnEn.translations,
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
  });
  zxcvbnReady = true;
}

export async function hashPassword(password: string): Promise<string> {
  // argon2id defaults from @node-rs/argon2 (19 MiB memory, 2 iterations) meet
  // current OWASP minimums; tune via options here if that changes.
  return argon2Hash(password);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hashed, password);
  } catch {
    // Malformed/legacy hash — treat as non-match rather than a 500.
    return false;
  }
}

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

/**
 * Server-side policy check. `userInputs` (username, display name, email) are
 * fed to zxcvbn so "my-username-2024" style passwords score poorly.
 */
export function validatePassword(password: string, userInputs: string[] = []): PasswordCheck {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  ensureZxcvbn();
  const result = zxcvbn(password, userInputs.filter(Boolean));
  if (result.score < PASSWORD_MIN_SCORE) {
    const hint =
      result.feedback.warning ||
      result.feedback.suggestions[0] ||
      'Try a longer passphrase of unrelated words.';
    return { ok: false, reason: `Password is too guessable. ${hint}` };
  }
  return { ok: true };
}
