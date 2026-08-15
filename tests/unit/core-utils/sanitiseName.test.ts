/**
 * Unit tests for sanitiseName() — src/core/utils.ts
 *
 * Run: bun test tests/unit/core-utils/sanitiseName.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { sanitiseName } from '../../../src/core/utils';

describe('sanitiseName', () => {
  test('leaves a plain filename untouched', () => {
    expect(sanitiseName('Movie.Title.2024.1080p')).toBe('Movie.Title.2024.1080p');
  });

  test('replaces filesystem-reserved characters with underscores', () => {
    expect(sanitiseName('Movie: The Sequel? <2024> "Cut"')).toBe('Movie_ The Sequel_ _2024_ _Cut_');
  });

  test('strips control characters', () => {
    expect(sanitiseName('Movie\x00Title\x1F')).toBe('MovieTitle');
  });

  test('collapses repeated underscores from consecutive reserved chars', () => {
    expect(sanitiseName('Movie***Title')).toBe('Movie_Title');
  });

  test('collapses whitespace runs to a single space', () => {
    expect(sanitiseName('Movie   Title')).toBe('Movie Title');
  });

  test('trims leading/trailing dots and whitespace', () => {
    expect(sanitiseName('  ..Movie Title..  ')).toBe('Movie Title');
  });

  test('falls back to "unnamed" when nothing survives sanitisation', () => {
    expect(sanitiseName('...')).toBe('unnamed');
    expect(sanitiseName('')).toBe('unnamed');
    expect(sanitiseName('   ')).toBe('unnamed');
  });
});
