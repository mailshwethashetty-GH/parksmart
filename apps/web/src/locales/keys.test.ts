/** Every literal t('…') key used in the app exists in en.json. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en.json';

const SRC = join(import.meta.dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

function has(obj: unknown, key: string): boolean {
  return (
    key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj) !== undefined
  );
}

describe('i18n keys', () => {
  it('every t() key has an English string', () => {
    const missing: string[] = [];
    for (const file of files(SRC)) {
      for (const [, key] of readFileSync(file, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) {
        if (!has(en, key!)) missing.push(`${key} (${file.replace(SRC, 'src')})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
