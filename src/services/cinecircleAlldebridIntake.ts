/**
 * CineCircle fork-only AllDebrid direct-file intake.
 *
 * AllDebrid has no push change feed in the integration used by SchröDrive, so
 * this adapter reconciles read-only magnet status plus completed file trees,
 * emits stable direct-file events, and hands added/changed files to Arr.
 * It is deliberately not wired into the generic provider lifecycle.
 */

import { createHash } from 'node:crypto';
import { getDb } from '../core/db';
import type { AllDebridProvider } from '../providers/alldebrid';
import type { TorrentInfo, VirtualDirectory } from '../providers';
import { classifyTorrent } from '../core/mediaClassifier';

export type DirectFileAction = 'added' | 'changed' | 'deleted';
export type SourceCategory = 'Movies' | 'Shows';
export type ArrKind = 'radarr' | 'sonarr';

export interface AllDebridSnapshot {
  providerItemId: string;
  name: string;
  status: string;
  files: Array<{ path: string; size: number }>;
  observedAt: string;
}

export interface DirectFileEvent {
  provider: 'alldebrid';
  providerItemId: string;
  action: DirectFileAction;
  path: string;
  tree: Array<{ path: string; size: number }>;
  sourceCategory: SourceCategory;
  observedAt: string;
  stableDedupeKey: string;
}

export interface ArrRoute {
  kind: ArrKind;
  baseUrl: string;
  apiKey: string;
}

export interface ArrCommandResult {
  commandId: string;
  status: string;
  result?: string;
}

export interface ArrClient {
  submitScan(route: ArrRoute, event: DirectFileEvent): Promise<ArrCommandResult>;
  getCommand(route: ArrRoute, commandId: string): Promise<ArrCommandResult>;
}

export interface IntakeStateStore {
  getItem(providerItemId: string): IntakeState | undefined;
  listItems(): IntakeState[];
  saveItem(state: IntakeState): void;
  hasEvent(key: string): boolean;
  saveEvent(event: DirectFileEvent, arr?: ArrCommandResult): void;
  getCursor(): { recentAt?: string; fullAt?: string };
  saveCursor(mode: 'recent' | 'full', observedAt: string): void;
}

export interface IntakeState {
  providerItemId: string;
  fingerprint: string;
  path: string;
  tree: Array<{ path: string; size: number }>;
  sourceCategory: SourceCategory;
  lastAction: DirectFileAction;
  commandId?: string;
  terminalStatus?: string;
  updatedAt: string;
}

export class InMemoryIntakeStateStore implements IntakeStateStore {
  private readonly items = new Map<string, IntakeState>();
  private readonly events = new Map<string, DirectFileEvent>();
  private cursor: { recentAt?: string; fullAt?: string } = {};

  getItem(id: string): IntakeState | undefined { return this.items.get(id); }
  listItems(): IntakeState[] { return [...this.items.values()]; }
  saveItem(state: IntakeState): void { this.items.set(state.providerItemId, state); }
  hasEvent(key: string): boolean { return this.events.has(key); }
  saveEvent(event: DirectFileEvent): void { this.events.set(event.stableDedupeKey, event); }
  getCursor(): { recentAt?: string; fullAt?: string } { return { ...this.cursor }; }
  saveCursor(mode: 'recent' | 'full', observedAt: string): void { this.cursor[mode === 'recent' ? 'recentAt' : 'fullAt'] = observedAt; }
}

/** Persistent fork state; creates only its own table in the configured test DB. */
export class SqliteIntakeStateStore implements IntakeStateStore {
  constructor() {
    getDb().exec(`CREATE TABLE IF NOT EXISTS cinecircle_alldebrid_intake (
      provider_item_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    getDb().exec(`CREATE TABLE IF NOT EXISTS cinecircle_alldebrid_events (
      dedupe_key TEXT PRIMARY KEY,
      event_json TEXT NOT NULL,
      arr_json TEXT,
      created_at INTEGER NOT NULL
    )`);
    getDb().exec(`CREATE TABLE IF NOT EXISTS cinecircle_alldebrid_cursor (
      name TEXT PRIMARY KEY,
      observed_at TEXT NOT NULL
    )`);
  }
  getItem(id: string): IntakeState | undefined {
    const row = getDb().prepare('SELECT state_json FROM cinecircle_alldebrid_intake WHERE provider_item_id = ?').get(id) as { state_json?: string } | undefined;
    return row?.state_json ? JSON.parse(row.state_json) as IntakeState : undefined;
  }
  listItems(): IntakeState[] {
    return (getDb().prepare('SELECT state_json FROM cinecircle_alldebrid_intake').all() as Array<{ state_json: string }>)
      .flatMap((row) => { try { return [JSON.parse(row.state_json) as IntakeState]; } catch { return []; } });
  }
  saveItem(state: IntakeState): void {
    getDb().prepare(`INSERT INTO cinecircle_alldebrid_intake(provider_item_id,state_json,updated_at)
      VALUES (?,?,?) ON CONFLICT(provider_item_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
      .run(state.providerItemId, JSON.stringify(state), Date.parse(state.updatedAt));
  }
  hasEvent(key: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM cinecircle_alldebrid_events WHERE dedupe_key = ?').get(key);
  }
  saveEvent(event: DirectFileEvent, arr?: ArrCommandResult): void {
    getDb().prepare(`INSERT OR IGNORE INTO cinecircle_alldebrid_events(dedupe_key,event_json,arr_json,created_at)
      VALUES (?,?,?,?)`).run(event.stableDedupeKey, JSON.stringify(event), arr ? JSON.stringify(arr) : null, Date.parse(event.observedAt));
  }
  getCursor(): { recentAt?: string; fullAt?: string } {
    const rows = getDb().prepare('SELECT name, observed_at FROM cinecircle_alldebrid_cursor').all() as Array<{ name: string; observed_at: string }>;
    return Object.fromEntries(rows.map((row) => [row.name === 'recent' ? 'recentAt' : 'fullAt', row.observed_at]));
  }
  saveCursor(mode: 'recent' | 'full', observedAt: string): void {
    getDb().prepare(`INSERT INTO cinecircle_alldebrid_cursor(name,observed_at) VALUES (?,?)
      ON CONFLICT(name) DO UPDATE SET observed_at=excluded.observed_at`).run(mode, observedAt);
  }
}

export class HttpArrClient implements ArrClient {
  async submitScan(route: ArrRoute, event: DirectFileEvent): Promise<ArrCommandResult> {
    const commandName = route.kind === 'radarr' ? 'DownloadedMoviesScan' : 'DownloadedEpisodesScan';
    const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/api/v3/command`, {
      method: 'POST',
      headers: { 'X-Api-Key': route.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: commandName, path: event.path, importMode: 'Move' }),
    });
    if (!response.ok) throw new Error(`Arr command submission failed: HTTP ${response.status}`);
    const body = await response.json() as { id?: number; status?: string; result?: string };
    if (!body.id) throw new Error('Arr command response did not include an id');
    return { commandId: String(body.id), status: body.status || 'queued', result: body.result };
  }

  async getCommand(route: ArrRoute, commandId: string): Promise<ArrCommandResult> {
    const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/api/v3/command/${encodeURIComponent(commandId)}`, {
      headers: { 'X-Api-Key': route.apiKey },
    });
    if (!response.ok) throw new Error(`Arr command status failed: HTTP ${response.status}`);
    const body = await response.json() as { id?: number; status?: string; result?: string };
    return { commandId, status: body.status || 'unknown', result: body.result };
  }
}

export interface AllDebridReadOnlySource {
  listSnapshot(): Promise<AllDebridSnapshot[]>;
  listRecentSnapshot?(limit: number): Promise<AllDebridSnapshot[]>;
}

/** Uses only the existing provider's status and completed-directory methods. */
export class AllDebridProviderSource implements AllDebridReadOnlySource {
  constructor(private readonly provider: Pick<AllDebridProvider, 'listTorrents' | 'fetchDirectories' | 'fetchDirectoriesForIds'>) {}

  async listSnapshot(): Promise<AllDebridSnapshot[]> {
    const observedAt = new Date().toISOString();
    const torrents = await this.provider.listTorrents();
    const directories = await this.provider.fetchDirectories();
    const trees = new Map(directories.map((directory) => [String(directory.id), directory]));
    return this.toSnapshots(torrents, trees, observedAt);
  }

  async listRecentSnapshot(limit: number): Promise<AllDebridSnapshot[]> {
    const observedAt = new Date().toISOString();
    const torrents = (await this.provider.listTorrents())
      .sort((a, b) => (b.addedAt?.getTime() || 0) - (a.addedAt?.getTime() || 0))
      .slice(0, Math.max(0, limit));
    const directories = await this.provider.fetchDirectoriesForIds(torrents);
    return this.toSnapshots(torrents, new Map(directories.map((directory) => [String(directory.id), directory])), observedAt);
  }

  private toSnapshots(torrents: TorrentInfo[], trees: Map<string, VirtualDirectory>, observedAt: string): AllDebridSnapshot[] {
    return torrents.map((torrent) => {
      const directory = trees.get(String(torrent.id));
      return { providerItemId: String(torrent.id), name: torrent.name, status: torrent.status,
        files: (directory?.files || []).map((file) => ({ path: file.name, size: file.size })), observedAt };
    });
  }
}

export interface IntakeOptions {
  dryRun?: boolean;
  maxAttempts?: number;
  routeFor: (category: SourceCategory) => ArrRoute;
  onEvent?: (event: DirectFileEvent) => Promise<void> | void;
  onReview?: (event: DirectFileEvent, error: Error) => Promise<void> | void;
}

const VIDEO_EXTENSIONS = new Set(['3g2', '3gp', 'avi', 'flv', 'mkv', 'mk3d', 'm4v', 'mov', 'mp2', 'mp4', 'mpe', 'mpeg', 'mpg', 'mpv', 'ts', 'm2ts', 'webm', 'wmv', 'ogm']);
// Keep subtitles and sidecar subtitle attachments with the video tree.
const SUBTITLE_EXTENSIONS = new Set(['ass', 'idx', 'mpsub', 'sbv', 'smi', 'srt', 'ssa', 'sub', 'sup', 'vtt']);

export function isMediaFile(filePath: string): boolean {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(extension) || SUBTITLE_EXTENSIONS.has(extension);
}

function categoryFor(snapshot: AllDebridSnapshot): SourceCategory {
  return classifyTorrent(snapshot.name, snapshot.files.map((file) => file.path)) === 'shows' ? 'Shows' : 'Movies';
}

function fingerprint(snapshot: Pick<AllDebridSnapshot, 'providerItemId' | 'files' | 'status'>): string {
  return createHash('sha256').update(JSON.stringify({ id: snapshot.providerItemId, status: snapshot.status, files: snapshot.files })).digest('hex');
}

function eventKey(id: string, action: DirectFileAction, fp: string): string {
  return `alldebrid:${id}:${action}:${fp}`;
}

export class CineCircleAllDebridIntake {
  constructor(
    private readonly source: AllDebridReadOnlySource,
    private readonly arr: ArrClient,
    private readonly store: IntakeStateStore,
    private readonly options: IntakeOptions,
  ) {}

  async reconcile(mode: 'recent' | 'full' = 'full', recentLimit = 30): Promise<DirectFileEvent[]> {
    await this.pollPendingCommands();
    const current = mode === 'recent' && this.source.listRecentSnapshot
      ? await this.source.listRecentSnapshot(recentLimit)
      : await this.source.listSnapshot();
    const seen = new Set(current.map((item) => item.providerItemId));
    const events: DirectFileEvent[] = [];

    for (const item of current) {
      if (item.status !== 'finished' || item.files.length === 0) continue;
      item.files = item.files.filter((file) => isMediaFile(file.path));
      if (item.files.length === 0) continue;
      const prior = this.store.getItem(item.providerItemId);
      const nextFingerprint = fingerprint(item);
      const action: DirectFileAction | undefined = !prior || prior.lastAction === 'deleted'
        ? 'added' : prior.fingerprint === nextFingerprint ? undefined : 'changed';
      if (!action) continue;
      const event = this.makeEvent(item, action, nextFingerprint);
      await this.dispatch(event, item, nextFingerprint);
      events.push(event);
    }

    // A missing status-list item is a removal, but an item still processing is not.
    for (const previous of mode === 'full' ? this.store.listItems().filter((item) => item.lastAction !== 'deleted') : []) {
      if (seen.has(previous.providerItemId)) continue;
      const event: DirectFileEvent = {
        provider: 'alldebrid', providerItemId: previous.providerItemId, action: 'deleted',
        path: previous.path, tree: [], sourceCategory: previous.sourceCategory,
        observedAt: new Date().toISOString(), stableDedupeKey: eventKey(previous.providerItemId, 'deleted', previous.fingerprint),
      };
      if (!this.store.hasEvent(event.stableDedupeKey)) {
        await this.options.onEvent?.(event);
        this.store.saveEvent(event);
        this.store.saveItem({ ...previous, tree: previous.tree || [], lastAction: 'deleted', updatedAt: event.observedAt });
        events.push(event);
      }
    }
    this.store.saveCursor(mode, new Date().toISOString());
    return events;
  }

  /** Reconciles Arr command state after a crash or an interrupted poll. */
  private async pollPendingCommands(): Promise<void> {
    for (const item of this.store.listItems()) {
      if (!item.commandId || item.terminalStatus === 'completed' || item.terminalStatus === 'failed') continue;
      try {
        const command = await this.arr.getCommand(this.options.routeFor(item.sourceCategory), item.commandId);
        this.store.saveItem({ ...item, terminalStatus: command.status, updatedAt: new Date().toISOString() });
        if (command.status === 'failed') {
          await this.options.onReview?.({
            provider: 'alldebrid', providerItemId: item.providerItemId, action: item.lastAction,
            path: item.path, tree: item.tree || [], sourceCategory: item.sourceCategory,
            observedAt: new Date().toISOString(),
            stableDedupeKey: eventKey(item.providerItemId, item.lastAction, item.fingerprint),
          }, new Error(`Arr command ${item.commandId} failed`));
        }
      } catch {
        // A transient status failure is retried on the next reconciliation.
      }
    }
  }

  private makeEvent(item: AllDebridSnapshot, action: DirectFileAction, fp: string): DirectFileEvent {
    const category = categoryFor(item);
    return {
      provider: 'alldebrid', providerItemId: item.providerItemId, action,
      path: item.files[0].path, tree: item.files, sourceCategory: category,
      observedAt: item.observedAt, stableDedupeKey: eventKey(item.providerItemId, action, fp),
    };
  }

  private async dispatch(event: DirectFileEvent, item: AllDebridSnapshot, fp: string): Promise<void> {
    if (this.store.hasEvent(event.stableDedupeKey)) return;
    await this.options.onEvent?.(event);
    if (this.options.dryRun) {
      this.store.saveEvent(event);
      this.store.saveItem({ providerItemId: item.providerItemId, fingerprint: fp, path: event.path, tree: event.tree, sourceCategory: event.sourceCategory, lastAction: event.action, updatedAt: event.observedAt });
      return;
    }
    const route = this.options.routeFor(event.sourceCategory);
    let lastError: unknown;
    for (let attempt = 1; attempt <= (this.options.maxAttempts || 3); attempt++) {
      try {
        const command = await this.arr.submitScan(route, event);
        this.store.saveEvent(event, command);
        this.store.saveItem({ providerItemId: item.providerItemId, fingerprint: fp, path: event.path, tree: event.tree, sourceCategory: event.sourceCategory, lastAction: event.action, commandId: command.commandId, terminalStatus: command.status, updatedAt: event.observedAt });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    const error = lastError instanceof Error ? lastError : new Error(String(lastError));
    await this.options.onReview?.(event, error);
    throw error;
  }
}

/**
 * Testable scheduler for the fork worker. It is intentionally not started by
 * the application entry point; CineCircle wiring must explicitly opt in.
 */
export class CineCircleAllDebridReconciliationWorker {
  private recentTimer: ReturnType<typeof setInterval> | undefined;
  private fullTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly intake: CineCircleAllDebridIntake,
    private readonly intervals: { recentMs: number; fullMs: number; recentLimit?: number },
  ) {}

  runRecent(): Promise<DirectFileEvent[]> { return this.intake.reconcile('recent', this.intervals.recentLimit || 30); }
  runFull(): Promise<DirectFileEvent[]> { return this.intake.reconcile('full'); }

  start(): void {
    if (this.recentTimer || this.fullTimer) return;
    this.runRecent().catch(() => undefined);
    this.runFull().catch(() => undefined);
    this.recentTimer = setInterval(() => { this.runRecent().catch(() => undefined); }, this.intervals.recentMs);
    this.fullTimer = setInterval(() => { this.runFull().catch(() => undefined); }, this.intervals.fullMs);
  }

  stop(): void {
    if (this.recentTimer) clearInterval(this.recentTimer);
    if (this.fullTimer) clearInterval(this.fullTimer);
    this.recentTimer = undefined;
    this.fullTimer = undefined;
  }
}
