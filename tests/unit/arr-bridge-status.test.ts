import { describe, expect, test } from 'bun:test';
import { findProviderTorrent, shouldPollTorrent } from '../../src/services/arrBridgeStatus';

const tracked = {
  name: 'Backrooms 2026 iTA-ENG Bluray 2160p HEVC HDR x265-CYBER',
  state: 'error', mountScanned: false,
  providerResults: [{ provider: 'alldebrid', id: '123', success: true }],
};

describe('arr bridge provider identity and recovery', () => {
  test('recovers a stale error even when the provider renamed the release', () => {
    const ready = { provider: 'alldebrid', id: '123', name: 'Backrooms.2026.mkv', progress: 100 };
    expect(shouldPollTorrent(tracked)).toBe(true);
    expect(findProviderTorrent(tracked, [ready])).toBe(ready);
  });
  test('does not confuse provider IDs or similarly named releases', () => {
    expect(findProviderTorrent(tracked, [
      { provider: 'realdebrid', id: '123', name: tracked.name },
      { provider: 'alldebrid', id: '456', name: tracked.name },
    ])).toBeUndefined();
  });
  test('retains duplicate names across providers and prefers submitted identity', () => {
    const match = { provider: 'alldebrid', id: '123', name: tracked.name };
    expect(findProviderTorrent(tracked, [
      { provider: 'realdebrid', id: 'other', name: tracked.name }, match,
    ])).toBe(match);
  });
  test('does not retry failed submissions or completed imports', () => {
    expect(shouldPollTorrent({ ...tracked, providerResults: [] })).toBe(false);
    expect(shouldPollTorrent({ ...tracked, mountScanned: true })).toBe(false);
  });
  test('legacy name fallback must be exact, nonempty and unambiguous', () => {
    const legacy = { ...tracked, name: 'Movie.2026', providerResults: [] };
    const match = { provider: 'alldebrid', id: '1', name: 'Movie 2026' };
    expect(findProviderTorrent(legacy, [match])).toBe(match);
    expect(findProviderTorrent(legacy, [match, { ...match, id: '2' }])).toBeUndefined();
    expect(findProviderTorrent({ ...legacy, name: '' }, [match])).toBeUndefined();
    expect(findProviderTorrent(legacy, [{ ...match, name: 'Movie 2026 1080p' }])).toBeUndefined();
  });
});
