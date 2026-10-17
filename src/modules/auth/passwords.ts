import argon2 from 'argon2';

export const MIN_PASSWORD_LENGTH = 12;

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id });

// Verified against when the email is unknown, so both failures take about the same time.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  try {
    if (!hash) {
      dummyHash ??= hashPassword('not-a-real-password-just-for-timing');
      await argon2.verify(await dummyHash, password);
      return false;
    }
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
