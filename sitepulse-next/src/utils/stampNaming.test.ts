import { describe, it, expect } from 'vitest';
import { stampBaseName, nextStampName } from './stampNaming';

describe('stampBaseName', () => {
  it('strips a trailing "(Stamp N)" suffix', () => {
    expect(stampBaseName('Office (Stamp 3)')).toBe('Office');
    expect(stampBaseName('Break Room (Stamp 12)')).toBe('Break Room');
  });

  it('leaves an un-suffixed name unchanged', () => {
    expect(stampBaseName('Office')).toBe('Office');
    expect(stampBaseName('Unit 204')).toBe('Unit 204');
  });

  it('trims surrounding whitespace', () => {
    expect(stampBaseName('  Office  (Stamp 1)')).toBe('Office');
  });

  it('only strips a suffix at the very end', () => {
    // A "(Stamp N)" mid-name is part of the base, not the running suffix.
    expect(stampBaseName('Room (Stamp 2) Annex')).toBe('Room (Stamp 2) Annex');
  });
});

describe('nextStampName', () => {
  it('starts at 1 when no prior stamps of this base exist', () => {
    expect(nextStampName('Office', [])).toBe('Office (Stamp 1)');
    expect(nextStampName('Office', ['Lobby', 'Stair A'])).toBe('Office (Stamp 1)');
  });

  it('returns one past the highest existing index for the base', () => {
    expect(nextStampName('Office', ['Office (Stamp 1)', 'Office (Stamp 2)'])).toBe('Office (Stamp 3)');
  });

  it('handles gaps and out-of-order indices (max + 1, not count + 1)', () => {
    expect(nextStampName('Office', ['Office (Stamp 5)', 'Office (Stamp 2)'])).toBe('Office (Stamp 6)');
  });

  it('ignores stamps of a different base', () => {
    expect(nextStampName('Office', ['Lobby (Stamp 9)', 'Office (Stamp 1)'])).toBe('Office (Stamp 2)');
  });

  it('tolerates flexible spacing inside the suffix', () => {
    expect(nextStampName('Office', ['Office (Stamp  4)'])).toBe('Office (Stamp 5)');
  });
});
