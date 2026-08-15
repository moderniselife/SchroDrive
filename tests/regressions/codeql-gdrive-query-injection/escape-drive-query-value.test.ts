/**
 * Regression test for a CodeQL js/incomplete-sanitization finding on
 * gdriveAdapter.ts's path-to-folder-ID resolver (alert #3).
 *
 * https://github.com/moderniselife/SchroDrive/security/code-scanning/3
 *
 * The Drive API query built a `name='<segment>'` filter and only escaped
 * single quotes, not backslashes. Escaping the delimiter without first
 * escaping the escape character itself means a path segment ending in a
 * backslash can smuggle an unescaped quote past the sanitiser and break
 * out of the string literal, e.g. `foo\` + the sanitiser's own `\'` ==
 * `foo\\'` — Drive's parser reads `\\` as a literal backslash, leaving the
 * following quote unescaped and closing the string early.
 *
 * Run: bun test tests/regressions/codeql-gdrive-query-injection/
 */

import { describe, expect, test } from 'bun:test';
import { escapeDriveQueryValue } from '../../../src/services/cloudLinks/gdriveAdapter';

describe('CodeQL #3 — Drive API query escaping', () => {
  test('leaves plain segment names untouched', () => {
    expect(escapeDriveQueryValue('Season 01')).toBe('Season 01');
  });

  test('escapes a single quote', () => {
    expect(escapeDriveQueryValue("O'Brien's Movie")).toBe("O\\'Brien\\'s Movie");
  });

  test('escapes backslashes before quotes so a trailing backslash cannot neutralise the quote escape', () => {
    // A naive `.replace(/'/g, "\\'")`-only implementation turns `foo\'` into
    // `foo\\'` — Drive reads \\ as one literal backslash, leaving the `'`
    // unescaped and able to close the string literal early.
    const malicious = "foo\\' or name!=''";
    const escaped = escapeDriveQueryValue(malicious);

    // Every backslash in the output must be doubled, and every quote must
    // be preceded by an odd (correctly-escaping) run of backslashes.
    const quoteIndex = escaped.indexOf("'");
    expect(quoteIndex).toBeGreaterThan(0);
    let backslashRun = 0;
    for (let i = quoteIndex - 1; i >= 0 && escaped[i] === '\\'; i--) backslashRun++;
    expect(backslashRun % 2).toBe(1);
  });

  test('round-trips a segment containing both backslashes and quotes', () => {
    expect(escapeDriveQueryValue("a\\b'c")).toBe("a\\\\b\\'c");
  });
});
