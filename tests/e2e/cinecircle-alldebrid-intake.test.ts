import { describe, expect, test } from 'bun:test';
import { closeDb } from '../../src/core/db';
import {
  CineCircleAllDebridIntake,
  InMemoryIntakeStateStore,
  SqliteIntakeStateStore,
  type AllDebridSnapshot,
  type ArrClient,
  type ArrCommandResult,
  type DirectFileEvent,
  isMediaFile,
  AllDebridProviderSource,
  CineCircleAllDebridReconciliationWorker,
} from '../../src/services/cinecircleAlldebridIntake';

function snapshot(id: string, name: string, files = [{ path: `${name}.mkv`, size: 10 }]): AllDebridSnapshot {
  return { providerItemId: id, name, status: 'finished', files, observedAt: '2026-09-17T00:00:00.000Z' };
}

class SequenceSource {
  constructor(private readonly rounds: AllDebridSnapshot[][]) {}
  async listSnapshot(): Promise<AllDebridSnapshot[]> { return this.rounds.shift() || []; }
}

class FakeArr implements ArrClient {
  submitted: Array<{ kind: string; event: DirectFileEvent }> = [];
  polled: string[] = [];
  async submitScan(route: any, event: DirectFileEvent): Promise<ArrCommandResult> {
    this.submitted.push({ kind: route.kind, event });
    return { commandId: `${route.kind}-${this.submitted.length}`, status: 'queued' };
  }
  async getCommand(_route: any, commandId: string): Promise<ArrCommandResult> {
    this.polled.push(commandId);
    return { commandId, status: 'completed', result: 'successful' };
  }
}

const routeFor = (category: 'Movies' | 'Shows') => ({
  kind: category === 'Movies' ? 'radarr' as const : 'sonarr' as const,
  baseUrl: `http://${category.toLowerCase()}.test`,
  apiKey: 'fixture-key',
});

describe('CineCircle AllDebrid direct intake', () => {
  test('uses the existing AllDebrid client for bounded recent and full snapshots', async () => {
    const recentRequests: string[][] = [];
    let fullCalls = 0;
    const provider = {
      async listTorrents() {
        return [
          { id: 'old', name: 'Old Movie', filename: 'Old Movie', status: 'finished', progress: 100, bytes: 1, files: [], addedAt: new Date('2026-09-16T00:00:00Z') },
          { id: 'new', name: 'New Movie', filename: 'New Movie', status: 'finished', progress: 100, bytes: 1, files: [], addedAt: new Date('2026-09-17T00:00:00Z') },
        ];
      },
      async fetchDirectories() {
        fullCalls++;
        return [{ id: 'old', name: 'Old Movie', originalName: 'Old Movie', files: [{ id: 'old.mkv', name: 'old.mkv', size: 1 }] }, { id: 'new', name: 'New Movie', originalName: 'New Movie', files: [{ id: 'new.mkv', name: 'new.mkv', size: 1 }] }];
      },
      async fetchDirectoriesForIds(items: Array<{ id: string }>) {
        recentRequests.push(items.map((item) => item.id));
        return items.map((item) => ({ id: item.id, name: item.id, originalName: item.id, files: [{ id: `${item.id}.mkv`, name: `${item.id}.mkv`, size: 1 }] }));
      },
    };
    const source = new AllDebridProviderSource(provider as any);
    const recent = await source.listRecentSnapshot!(1);
    const full = await source.listSnapshot();
    expect(recent.map((item) => item.providerItemId)).toEqual(['new']);
    expect(recentRequests).toEqual([['new']]);
    expect(full.map((item) => item.providerItemId)).toEqual(['old', 'new']);
    expect(fullCalls).toBe(1);

    const arr = new FakeArr();
    const intake = new CineCircleAllDebridIntake(
      new AllDebridProviderSource(provider as any), arr, new InMemoryIntakeStateStore(), { routeFor },
    );
    const events = await intake.reconcile('recent', 1);
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe('alldebrid');
    expect(arr.submitted[0].kind).toBe('radarr');
  });

  test('emits add and routes Movies to Radarr and Shows to Sonarr', async () => {
    const arr = new FakeArr();
    const intake = new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('m-1', 'Movie (2026)'), snapshot('s-1', 'Show S01E02')]]),
      arr,
      new InMemoryIntakeStateStore(),
      { routeFor },
    );

    const events = await intake.reconcile();
    expect(events.map((event) => event.action)).toEqual(['added', 'added']);
    expect(events.map((event) => event.sourceCategory)).toEqual(['Movies', 'Shows']);
    expect(arr.submitted.map((item) => item.kind)).toEqual(['radarr', 'sonarr']);
    expect(arr.submitted[0].event.path).toBe('Movie (2026).mkv');
  });

  test('emits changed when a completed file tree changes, even after a missed round', async () => {
    const store = new InMemoryIntakeStateStore();
    const arr = new FakeArr();
    const intake = new CineCircleAllDebridIntake(
      new SequenceSource([
        [snapshot('m-1', 'Movie (2026)', [{ path: 'Movie.mkv', size: 10 }])],
        [snapshot('m-1', 'Movie (2026)', [{ path: 'Movie.mkv', size: 20 }])],
      ]),
      arr, store, { routeFor },
    );
    await intake.reconcile();
    const second = await intake.reconcile();
    expect(second).toHaveLength(1);
    expect(second[0].action).toBe('changed');
    expect(second[0].stableDedupeKey).not.toBe((await intake.reconcile())[0]?.stableDedupeKey);
  });

  test('suppresses duplicate delivery and emits deletion from a missing status item', async () => {
    const store = new InMemoryIntakeStateStore();
    const arr = new FakeArr();
    const intake = new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('m-1', 'Movie (2026)')], [snapshot('m-1', 'Movie (2026)')], []]),
      arr, store, { routeFor },
    );
    expect((await intake.reconcile()).map((e) => e.action)).toEqual(['added']);
    expect(await intake.reconcile()).toEqual([]);
    expect((await intake.reconcile()).map((e) => e.action)).toEqual(['deleted']);
    expect(arr.submitted).toHaveLength(1);
  });

  test('dry-run persists state without submitting to Arr', async () => {
    const arr = new FakeArr();
    const store = new InMemoryIntakeStateStore();
    const intake = new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('m-1', 'Movie (2026)')]]), arr, store,
      { routeFor, dryRun: true },
    );
    const events = await intake.reconcile();
    expect(events).toHaveLength(1);
    expect(arr.submitted).toHaveLength(0);
    expect(store.getItem('m-1')?.lastAction).toBe('added');
  });

  test('keeps all supported subtitles and attachments in the event tree', async () => {
    const names = ['video.mkv', 'captions.srt', 'captions.ass', 'captions.ssa', 'captions.sub', 'captions.vtt', 'captions.idx', 'captions.sup', 'captions.sbv', 'captions.mpsub', 'cover.jpg'];
    const arr = new FakeArr();
    const intake = new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('m-1', 'Movie (2026)', names.map((path) => ({ path, size: 1 })))]]) ,
      arr, new InMemoryIntakeStateStore(), { routeFor },
    );
    const events = await intake.reconcile();
    expect(names.filter(isMediaFile)).toHaveLength(10);
    expect(events[0].tree.map((file) => file.path)).toEqual(names.slice(0, 10));
  });

  test('restarts from persisted state and polls the pending Arr command', async () => {
    const store = new InMemoryIntakeStateStore();
    const firstArr = new FakeArr();
    await new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('m-1', 'Movie (2026)')]]), firstArr, store, { routeFor },
    ).reconcile();
    const secondArr = new FakeArr();
    const events = await new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('m-1', 'Movie (2026)')]]), secondArr, store, { routeFor },
    ).reconcile();
    expect(events).toEqual([]);
    expect(secondArr.polled).toEqual(['radarr-1']);
    expect(store.getItem('m-1')?.terminalStatus).toBe('completed');
  });

  test('persists the direct event and cursor across a SQLite store restart', async () => {
    const firstArr = new FakeArr();
    const firstStore = new SqliteIntakeStateStore();
    const source = new SequenceSource([[snapshot('sqlite-1', 'Movie (2026)')]]);
    const first = new CineCircleAllDebridIntake(source, firstArr, firstStore, { routeFor });
    const events = await first.reconcile('full');
    expect(events).toHaveLength(1);
    expect(firstStore.getCursor().fullAt).toBeDefined();
    expect(firstStore.hasEvent(events[0].stableDedupeKey)).toBe(true);

    closeDb();
    const secondStore = new SqliteIntakeStateStore();
    const secondArr = new FakeArr();
    const second = new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('sqlite-1', 'Movie (2026)')]]), secondArr, secondStore, { routeFor },
    );
    expect(await second.reconcile('full')).toEqual([]);
    expect(secondArr.submitted).toHaveLength(0);
    expect(secondStore.getItem('sqlite-1')?.lastAction).toBe('added');
    closeDb();
  });

  test('retries transient Arr submission failures and preserves one correlation', async () => {
    let attempts = 0;
    const arr: ArrClient = {
      async submitScan() {
        attempts++;
        if (attempts < 3) throw new Error('temporary');
        return { commandId: 'sonarr-1', status: 'queued' };
      },
      async getCommand(_route, commandId) { return { commandId, status: 'completed' }; },
    };
    const intake = new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('s-1', 'Show S01E02')]]), arr, new InMemoryIntakeStateStore(),
      { routeFor, maxAttempts: 3 },
    );
    await intake.reconcile();
    expect(attempts).toBe(3);
  });

  test('hands permanent Arr failure to Review after bounded retries', async () => {
    const reviewed: DirectFileEvent[] = [];
    const arr: ArrClient = {
      async submitScan() { throw new Error('permanent'); },
      async getCommand(_route, commandId) { return { commandId, status: 'failed' }; },
    };
    const intake = new CineCircleAllDebridIntake(
      new SequenceSource([[snapshot('m-1', 'Movie (2026)')]]), arr, new InMemoryIntakeStateStore(),
      { routeFor, maxAttempts: 2, onReview: (event) => { reviewed.push(event); } },
    );
    await expect(intake.reconcile()).rejects.toThrow('permanent');
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0].action).toBe('added');
  });

  test('starts recent and full polling at configured intervals and stops cleanly', async () => {
    let calls = 0;
    const intake = { async reconcile() { calls++; return []; } };
    const worker = new CineCircleAllDebridReconciliationWorker(intake as any, { recentMs: 10, fullMs: 15, recentLimit: 2 });
    worker.start();
    expect(worker.isRunning()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    worker.stop();
    const stoppedAt = calls;
    expect(stoppedAt).toBeGreaterThanOrEqual(2);
    expect(worker.isRunning()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(calls).toBe(stoppedAt);
  });
});
