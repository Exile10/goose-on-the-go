/**
 * Cryptographic random bytes from the platform (SecRandomCopyBytes on iOS,
 * SecureRandom on Android). `Math.random` is not a substitute where an
 * observer must not be able to predict the result.
 */
import { getRandomBytes } from 'expo-crypto';

export function randomBytes(count: number): Uint8Array {
  return getRandomBytes(count);
}
