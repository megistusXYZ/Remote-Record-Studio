import { randomInt } from "node:crypto";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * URL-safe random id from a cryptographically secure source. Invite codes are
 * bearer secrets (anyone holding one can join a session), so they must not be
 * guessable; `Math.random` is not acceptable for that. `randomInt` draws
 * uniformly, so there is no modulo bias across the 62-character alphabet.
 */
export function nanoid(size = 21): string {
  let id = "";
  for (let i = 0; i < size; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}
