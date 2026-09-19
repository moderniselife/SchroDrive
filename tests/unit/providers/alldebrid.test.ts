import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { axiosIPv4 } from '../../../src/core/httpClient';
import { config } from '../../../src/core/config';
import { rateLimiter } from '../../../src/core/rateLimiter';
import { AllDebridProvider } from '../../../src/providers/alldebrid';

const originalPost = axiosIPv4.post;

function response(data: unknown) {
  return { data: { status: 'success', data } } as any;
}

describe('AllDebrid current magnet API', () => {
  let calls: Array<{ url: string; body: any }>;

  beforeEach(() => {
    calls = [];
    config.alldebridApiKey = 'unit-test-key';
    rateLimiter.setThrottleDelay('alldebrid', 0);
  });

  afterEach(() => {
    axiosIPv4.post = originalPost;
    config.alldebridApiKey = '';
  });

  test('adds a magnet without calling the obsolete selectFiles endpoint', async () => {
    axiosIPv4.post = async (url: string, body: any) => {
      calls.push({ url, body });
      return response({ magnets: [{ id: 123, ready: false }] });
    };

    const result = await new AllDebridProvider().addMagnet('magnet:?xt=urn:btih:abc');

    expect(result).toEqual({ id: '123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v4/magnet/upload');
    expect(calls[0].url).not.toContain('selectFiles');
  });

  test('uses the current upload/file-tree lifecycle for torrent uploads', async () => {
    axiosIPv4.post = async (url: string, body: any) => {
      calls.push({ url, body });
      return response({ files: [{ id: 456, ready: false }] });
    };

    const result = await new AllDebridProvider().addTorrentFile(Buffer.from('torrent'), 'fixture.torrent');

    expect(result).toEqual({ id: '456' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v4/magnet/upload/file');
    expect(calls[0].url).not.toContain('selectFiles');
  });

  test('flattens the current recursive file tree and preserves relative paths', async () => {
    axiosIPv4.post = async (url: string, body: any) => {
      calls.push({ url, body });
      if (url.includes('/magnet/status')) {
        return response({ magnets: [{ id: 789, filename: 'Release', statusCode: 4 }] });
      }
      return response({ magnets: [{
        id: 789,
        files: [
          { n: 'Movie.mkv', s: 100, l: 'https://alldebrid.test/file-mkv' },
          { n: 'Subs', e: [{ n: 'Movie.srt', s: 20, l: 'https://alldebrid.test/file-srt' }] },
        ],
      }] });
    };

    const dirs = await new AllDebridProvider().fetchDirectories();

    expect(dirs).toHaveLength(1);
    expect(dirs[0].files).toEqual([
      { id: 'Movie.mkv', name: 'Movie.mkv', size: 100 },
      { id: 'Subs/Movie.srt', name: 'Subs/Movie.srt', size: 20 },
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      expect.stringContaining('/v4.1/magnet/status'),
      expect.stringContaining('/v4/magnet/files'),
    ]);
    expect(String(calls[1].body)).toContain('id%5B%5D=789');
  });

  test('resolves a file link from magnet/files rather than status.links', async () => {
    axiosIPv4.post = async (url: string, body: any) => {
      calls.push({ url, body });
      if (url.includes('/magnet/files')) {
        return response({ magnets: [{
          id: 789,
          files: [{ n: 'Movie.mkv', s: 100, l: 'https://alldebrid.test/file-mkv' }],
        }] });
      }
      if (url.includes('/link/unlock')) {
        return response({ link: 'https://cdn.alldebrid.test/movie' });
      }
      throw new Error(`Unexpected endpoint: ${url}`);
    };

    const url = await new AllDebridProvider().resolveDownloadUrl('789', 'Movie.mkv');

    expect(url).toBe('https://cdn.alldebrid.test/movie');
    expect(calls.map((call) => call.url)).toEqual([
      expect.stringContaining('/v4/magnet/files'),
      expect.stringContaining('/v4/link/unlock'),
    ]);
  });
});
