import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_MIN_SCORE = 3;

let zxcvbn: ZxcvbnFactory | null = null;
function getZxcvbn(): ZxcvbnFactory {
  zxcvbn ??= new ZxcvbnFactory({
    translations: zxcvbnEn.translations,
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
  });
  return zxcvbn;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hashed, password);
  } catch {
    return false;
  }
}

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function validatePassword(password: string, userInputs: string[] = []): PasswordCheck {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  const result = getZxcvbn().check(password, userInputs.filter(Boolean));
  if (result.score < PASSWORD_MIN_SCORE) {
    const hint =
      result.feedback.warning ||
      result.feedback.suggestions[0] ||
      'Try a longer passphrase of unrelated words.';
    return { ok: false, reason: `Password is too guessable. ${hint}` };
  }
  return { ok: true };
}
