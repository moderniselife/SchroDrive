import { describe, expect, test, afterEach } from 'bun:test';
import { classifyTorrent } from '../../src/core/mediaClassifier';
import { parseMediaFilename } from '../../src/services/mediaParser';
import { HttpArrClient, type ArrRoute, type DirectFileEvent } from '../../src/services/cinecircleAlldebridIntake';

const originalFetch = globalThis.fetch;

function event(category: 'Movies' | 'Shows', path: string): DirectFileEvent {
  return {
    provider: 'alldebrid', providerItemId: 'fixture-item', action: 'added', path,
    tree: [{ path, size: 1 }], sourceCategory: category,
    observedAt: '2026-09-17T00:00:00.000Z', stableDedupeKey: `fixture:${category}:${path}`,
  };
}

function route(kind: 'radarr' | 'sonarr'): ArrRoute {
  return { kind, baseUrl: `http://${kind}.fixture`, apiKey: 'fixture-api-key' };
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe('CineCircle three-input fixture E2E', () => {
  test('A: historical library input parses and classifies without a write boundary', () => {
    const movie = parseMediaFilename('Fixture.Movie (2020).mkv', 'Movies/Fixture.Movie (2020).mkv');
    const episode = parseMediaFilename('Fixture.Show S01E02.mkv', 'Shows/Fixture.Show S01E02.mkv');
    expect(movie.kind).toBe('movie');
    expect(movie.year).toBe(2020);
    expect(episode.kind).toBe('episode');
    expect(episode.season).toBe(1);
    expect(episode.episode).toBe(2);
    expect(classifyTorrent('Fixture.Movie (2020).mkv')).toBe('movies');
    expect(classifyTorrent('Fixture.Show S01E02.mkv')).toBe('shows');
  });

  test('B: Seerr fixture routes movie and episode requests to Arr scan commands', async () => {
    const requests: Array<{ url: string; method?: string; headers: Record<string, string>; body?: any }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: requests.length, status: 'queued' }), { status: 201, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ id: 1, status: 'completed', result: 'successful' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const client = new HttpArrClient();
    const fixtureSeerrMovie = { mediaType: 'movie', tmdbId: 'fixture-movie-id', requestedPath: 'arr-visible/movie.mkv' };
    const fixtureSeerrTv = { mediaType: 'tv', tmdbId: 'fixture-tv-id', requestedPath: 'arr-visible/show.mkv' };
    await client.submitScan(route('radarr'), event('Movies', fixtureSeerrMovie.requestedPath));
    await client.submitScan(route('sonarr'), event('Shows', fixtureSeerrTv.requestedPath));
    await client.getCommand(route('radarr'), '1');
    await client.getCommand(route('sonarr'), '2');

    expect(requests.filter((request) => request.method === 'POST').map((request) => request.body.name)).toEqual([
      'DownloadedMoviesScan', 'DownloadedEpisodesScan',
    ]);
    expect(requests.filter((request) => request.method === 'POST').map((request) => request.body.path)).toEqual([
      'arr-visible/movie.mkv', 'arr-visible/show.mkv',
    ]);
    expect(requests.every((request) => request.headers['x-api-key'] === 'fixture-api-key')).toBe(true);
    expect(requests.filter((request) => request.method !== 'POST').map((request) => request.url)).toEqual([
      'http://radarr.fixture/api/v3/command/1', 'http://sonarr.fixture/api/v3/command/2',
    ]);
  });

  test('C: direct AllDebrid fixture reaches the same Arr completion boundary', async () => {
    const completed: string[] = [];
    const source = { async listSnapshot() { return [{ providerItemId: 'fixture-ad', name: 'Fixture.Show S01E02', status: 'finished', files: [{ path: 'arr-visible/show.mkv', size: 1 }], observedAt: '2026-09-17T00:00:00.000Z' }]; } };
    const store = new (await import('../../src/services/cinecircleAlldebridIntake')).InMemoryIntakeStateStore();
    const arr = {
      async submitScan(_route: ArrRoute, item: DirectFileEvent) { completed.push(`${item.sourceCategory}:${item.path}`); return { commandId: 'fixture-command', status: 'queued' }; },
      async getCommand(_route: ArrRoute, commandId: string) { return { commandId, status: 'completed', result: 'successful' }; },
    };
    const { CineCircleAllDebridIntake } = await import('../../src/services/cinecircleAlldebridIntake');
    const intake = new CineCircleAllDebridIntake(source, arr, store, { routeFor: () => route('sonarr') });
    await intake.reconcile();
    await intake.reconcile();
    expect(completed).toEqual(['Shows:arr-visible/show.mkv']);
    expect(store.getItem('fixture-ad')?.terminalStatus).toBe('completed');
  });
});
