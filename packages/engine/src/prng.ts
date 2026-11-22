/**
 * Seeded tie-break draw. Each request's draw depends only on (seed, date, requestId),
 * so the result never depends on input order, and replaying a round with its logged
 * seed reproduces it exactly. Uses pure-rand; never Math.random.
 */
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';

/** FNV-1a 32-bit hash of a string. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

export const MAX_DRAW = 0x7fffffff;

export function tiebreakDraw(seed: string, date: string, requestId: string): number {
  const rng = xoroshiro128plus(hash32(`${seed}|${date}|${requestId}`));
  return uniformInt(rng, 0, MAX_DRAW);
}
