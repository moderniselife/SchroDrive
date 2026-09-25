/**
 * Provider-agnostic direct-file reconciliation for mounted debrid providers.
 *
 * Providers do not need a push change feed for this path: the adapter
 * reconciles read-only torrent status plus completed file trees, emits stable
 * direct-file events, and hands added/changed files to Arr. It is deliberately
 * opt-in and separate from provider delete/repair lifecycle services.
 */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { getDb } from '../core/db';
import type { DebridProvider, TorrentInfo, VirtualDirectory } from '../providers';
import { classifyTorrent } from '../core/mediaClassifier';
import { parseMediaFilename } from './mediaParser';

export type DirectFileAction = 'added' | 'changed' | 'deleted';
export type SourceCategory = 'Movies' | 'Shows';
export type ArrKind = 'radarr' | 'sonarr';

export interface ProviderSnapshot {
  provider?: string;
  providerItemId: string;
  name: string;
  directoryName?: string;
  status: string;
  progress?: number;
  files: Array<{ path: string; size: number }>;
  observedAt: string;
}

export interface DirectFileEvent {
  provider: string;
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
  /** Absolute path visible inside the target Arr container. */
  sourcePathPrefix?: string;
  /** Import mode used by Arr for provider-backed paths. */
  importMode?: 'Move' | 'Copy';
  /** Optional Arr-visible library root. When set, media is exposed by symlink. */
  symlinkLibraryPath?: string;
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
  provider?: string;
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

/** Persistent reconciliation state in the configured SchröDrive DB. */
export class SqliteIntakeStateStore implements IntakeStateStore {
  constructor() {
    getDb().exec(`CREATE TABLE IF NOT EXISTS provider_reconciliation_intake (
      provider_item_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    getDb().exec(`CREATE TABLE IF NOT EXISTS provider_reconciliation_events (
      dedupe_key TEXT PRIMARY KEY,
      event_json TEXT NOT NULL,
      arr_json TEXT,
      created_at INTEGER NOT NULL
    )`);
    getDb().exec(`CREATE TABLE IF NOT EXISTS provider_reconciliation_cursor (
      name TEXT PRIMARY KEY,
      observed_at TEXT NOT NULL
    )`);
  }
  getItem(id: string): IntakeState | undefined {
    const row = getDb().prepare('SELECT state_json FROM provider_reconciliation_intake WHERE provider_item_id = ?').get(id) as { state_json?: string } | undefined;
    return row?.state_json ? JSON.parse(row.state_json) as IntakeState : undefined;
  }
  listItems(): IntakeState[] {
    return (getDb().prepare('SELECT state_json FROM provider_reconciliation_intake').all() as Array<{ state_json: string }>)
      .flatMap((row) => { try { return [JSON.parse(row.state_json) as IntakeState]; } catch { return []; } });
  }
  saveItem(state: IntakeState): void {
    getDb().prepare(`INSERT INTO provider_reconciliation_intake(provider_item_id,state_json,updated_at)
      VALUES (?,?,?) ON CONFLICT(provider_item_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
      .run(state.providerItemId, JSON.stringify(state), Date.parse(state.updatedAt));
  }
  hasEvent(key: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM provider_reconciliation_events WHERE dedupe_key = ?').get(key);
  }
  saveEvent(event: DirectFileEvent, arr?: ArrCommandResult): void {
    getDb().prepare(`INSERT OR IGNORE INTO provider_reconciliation_events(dedupe_key,event_json,arr_json,created_at)
      VALUES (?,?,?,?)`).run(event.stableDedupeKey, JSON.stringify(event), arr ? JSON.stringify(arr) : null, Date.parse(event.observedAt));
  }
  getCursor(): { recentAt?: string; fullAt?: string } {
    const rows = getDb().prepare('SELECT name, observed_at FROM provider_reconciliation_cursor').all() as Array<{ name: string; observed_at: string }>;
    return Object.fromEntries(rows.map((row) => [row.name === 'recent' ? 'recentAt' : 'fullAt', row.observed_at]));
  }
  saveCursor(mode: 'recent' | 'full', observedAt: string): void {
    getDb().prepare(`INSERT INTO provider_reconciliation_cursor(name,observed_at) VALUES (?,?)
      ON CONFLICT(name) DO UPDATE SET observed_at=excluded.observed_at`).run(mode, observedAt);
  }
}

export class HttpArrClient implements ArrClient {
  async submitScan(route: ArrRoute, event: DirectFileEvent): Promise<ArrCommandResult> {
    let commandName = route.kind === 'radarr' ? 'DownloadedMoviesScan' : 'DownloadedEpisodesScan';
    const providerPath = route.sourcePathPrefix
      ? `${route.sourcePathPrefix.replace(/\/$/, '')}/${event.path.replace(/^\/+/, '')}`
      : event.path;
    const scanPath = route.symlinkLibraryPath
      ? await exposeAsSymlink(route, event, providerPath)
      : providerPath;
    let commandBody: Record<string, unknown> = { name: commandName, path: scanPath, importMode: route.importMode || 'Copy' };
    if (route.symlinkLibraryPath) {
      const entityId = await findArrEntityId(route, event);
      commandName = route.kind === 'radarr' ? 'RescanMovie' : 'RescanSeries';
      commandBody = { name: commandName, [route.kind === 'radarr' ? 'movieId' : 'seriesId']: entityId };
    }
    const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/api/v3/command`, {
      method: 'POST',
      headers: { 'X-Api-Key': route.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(commandBody),
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

function normalizedTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

async function findArrEntityId(route: ArrRoute, event: DirectFileEvent): Promise<number> {
  const filename = path.basename(event.path);
  const parsed = parseMediaFilename(filename, event.path);
  const title = normalizedTitle(parsed.title || event.path.split('/').filter(Boolean).slice(-2, -1)[0] || '');
  const endpoint = route.kind === 'radarr' ? 'movie' : 'series';
  const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/api/v3/${endpoint}`, {
    headers: { 'X-Api-Key': route.apiKey },
  });
  if (!response.ok) throw new Error(`Arr ${endpoint} lookup failed: HTTP ${response.status}`);
  const records = await response.json() as Array<{ id?: number; title?: string }>; 
  const match = records.find((record) => record.id && normalizedTitle(record.title || '') === title);
  if (!match?.id) throw new Error(`Arr ${endpoint} record not found for ${parsed.title || filename}`);
  return match.id;
}

function safeSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Unknown';
}

/**
 * Creates the Arr-facing library entry without copying provider data. The
 * target is deliberately a symlink into the shared SchröDrive mount.
 */
async function exposeAsSymlink(route: ArrRoute, event: DirectFileEvent, providerPath: string): Promise<string> {
  const library = route.symlinkLibraryPath!;
  const filename = path.basename(event.path);
  const parsed = parseMediaFilename(filename, event.path);
  const pathParts = event.path.split('/').filter(Boolean);
  const title = safeSegment(parsed.title || pathParts[pathParts.length - 2] || path.parse(filename).name);
  const directory = event.sourceCategory === 'Shows'
    ? path.join(library, title, `Season ${parsed.season ?? 1}`)
    : path.join(library, parsed.year ? `${title} (${parsed.year})` : title);
  const destination = path.join(directory, filename);
  await fsp.mkdir(directory, { recursive: true });
  const existing = await fsp.lstat(destination).catch(() => undefined);
  if (existing?.isSymbolicLink()) {
    const current = await fsp.readlink(destination);
    if (current === providerPath) return destination;
    // Multiple providers may expose the same title. Keep the first healthy
    // provider-backed link instead of oscillating the library on every poll.
    return destination;
  } else if (existing) {
    throw new Error(`Refusing to overwrite non-symlink Arr library entry: ${destination}`);
  }
  // Use the container-visible absolute mount path. A relative link would be
  // resolved against the host bind source, which differs between SchröDrive
  // and Arr containers.
  await fsp.symlink(providerPath, destination);
  return destination;
}

export interface ProviderReadOnlySource {
  listSnapshot(): Promise<ProviderSnapshot[]>;
  listRecentSnapshot?(limit: number): Promise<ProviderSnapshot[]>;
}

/** Adapts SchröDrive's common provider contract to reconciliation snapshots. */
export class ProviderSnapshotSource implements ProviderReadOnlySource {
  constructor(private readonly provider: Pick<DebridProvider, 'id' | 'listTorrents' | 'fetchDirectories'> & { fetchDirectoriesForIds?: (torrents: TorrentInfo[]) => Promise<VirtualDirectory[]> }, private readonly namespaceIds = true) {}

  async listSnapshot(): Promise<ProviderSnapshot[]> {
    const observedAt = new Date().toISOString();
    const torrents = await this.provider.listTorrents();
    const directories = await this.provider.fetchDirectories();
    const trees = new Map(directories.map((directory) => [String(directory.id), directory]));
    return this.toSnapshots(torrents, trees, observedAt);
  }

  async listRecentSnapshot(limit: number): Promise<ProviderSnapshot[]> {
    const observedAt = new Date().toISOString();
    const torrents = (await this.provider.listTorrents())
      .sort((a, b) => (b.addedAt?.getTime() || 0) - (a.addedAt?.getTime() || 0))
      .slice(0, Math.max(0, limit));
    const directories = this.provider.fetchDirectoriesForIds
      ? await this.provider.fetchDirectoriesForIds(torrents)
      : await this.provider.fetchDirectories();
    return this.toSnapshots(torrents, new Map(directories.map((directory) => [String(directory.id), directory])), observedAt);
  }

  private toSnapshots(torrents: TorrentInfo[], trees: Map<string, VirtualDirectory>, observedAt: string): ProviderSnapshot[] {
    return torrents.map((torrent) => {
      const directory = trees.get(String(torrent.id));
      return { provider: this.provider.id, providerItemId: this.namespaceIds ? `${this.provider.id}:${torrent.id}` : String(torrent.id), name: torrent.name, directoryName: directory?.name || directory?.originalName, status: torrent.status, progress: torrent.progress,
        files: ((directory?.files?.length ? directory.files : torrent.files) || []).map((file) => ({ path: 'path' in file ? file.path : file.name, size: file.size })), observedAt };
    });
  }
}

export interface IntakeOptions {
  dryRun?: boolean;
  maxAttempts?: number;
  routeFor: (category: SourceCategory, provider?: string) => ArrRoute;
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

function categoryFor(snapshot: ProviderSnapshot): SourceCategory {
  return classifyTorrent(snapshot.name, snapshot.files.map((file) => file.path)) === 'shows' ? 'Shows' : 'Movies';
}

function isFinished(snapshot: ProviderSnapshot): boolean {
  const status = snapshot.status.toLowerCase();
  return snapshot.progress === undefined
    ? ['finished', 'downloaded', 'completed', 'seeding', 'ready', 'cached'].includes(status)
    : snapshot.progress >= 100 || ['finished', 'downloaded', 'completed', 'seeding', 'ready', 'cached'].includes(status);
}

function fingerprint(snapshot: Pick<ProviderSnapshot, 'providerItemId' | 'files' | 'status'>): string {
  return createHash('sha256').update(JSON.stringify({ id: snapshot.providerItemId, status: snapshot.status, files: snapshot.files })).digest('hex');
}

function eventKey(provider: string, id: string, action: DirectFileAction, fp: string): string {
  return `${provider}:${id}:${action}:${fp}`;
}

export class ProviderReconciliationIntake {
  constructor(
    private readonly source: ProviderReadOnlySource,
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
      if (!isFinished(item) || item.files.length === 0) continue;
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
        provider: previous.provider || 'alldebrid', providerItemId: previous.providerItemId, action: 'deleted',
        path: previous.path, tree: [], sourceCategory: previous.sourceCategory,
        observedAt: new Date().toISOString(), stableDedupeKey: eventKey(previous.provider || 'alldebrid', previous.providerItemId, 'deleted', previous.fingerprint),
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
        const command = await this.arr.getCommand(this.options.routeFor(item.sourceCategory, item.provider), item.commandId);
        this.store.saveItem({ ...item, terminalStatus: command.status, updatedAt: new Date().toISOString() });
        if (command.status === 'failed') {
          await this.options.onReview?.({
            provider: item.provider || 'alldebrid', providerItemId: item.providerItemId, action: item.lastAction,
            path: item.path, tree: item.tree || [], sourceCategory: item.sourceCategory,
            observedAt: new Date().toISOString(),
            stableDedupeKey: eventKey(item.provider || 'alldebrid', item.providerItemId, item.lastAction, item.fingerprint),
          }, new Error(`Arr command ${item.commandId} failed`));
        }
      } catch {
        // A transient status failure is retried on the next reconciliation.
      }
    }
  }

  private makeEvent(item: ProviderSnapshot, action: DirectFileAction, fp: string): DirectFileEvent {
    const provider = item.provider || 'alldebrid';
    const category = categoryFor(item);
    const categoryDirectory = category.toLowerCase();
    const providerPath = item.files[0].path.replace(/^\/+/, '');
    const path = item.directoryName
      ? `${categoryDirectory}/${item.directoryName.replace(/^\/+|\/+$/g, '')}/${providerPath}`
      : providerPath;
    return {
      provider, providerItemId: item.providerItemId, action,
      path, tree: item.files, sourceCategory: category,
      observedAt: item.observedAt, stableDedupeKey: eventKey(provider, item.providerItemId, action, fp),
    };
  }

  private async dispatch(event: DirectFileEvent, item: ProviderSnapshot, fp: string): Promise<void> {
    if (this.store.hasEvent(event.stableDedupeKey)) return;
    await this.options.onEvent?.(event);
    if (this.options.dryRun) {
      this.store.saveEvent(event);
      this.store.saveItem({ provider: event.provider, providerItemId: item.providerItemId, fingerprint: fp, path: event.path, tree: event.tree, sourceCategory: event.sourceCategory, lastAction: event.action, updatedAt: event.observedAt });
      return;
    }
    const route = this.options.routeFor(event.sourceCategory, event.provider);
    let lastError: unknown;
    for (let attempt = 1; attempt <= (this.options.maxAttempts || 3); attempt++) {
      try {
        const command = await this.arr.submitScan(route, event);
        this.store.saveEvent(event, command);
        this.store.saveItem({ provider: event.provider, providerItemId: item.providerItemId, fingerprint: fp, path: event.path, tree: event.tree, sourceCategory: event.sourceCategory, lastAction: event.action, commandId: command.commandId, terminalStatus: command.status, updatedAt: event.observedAt });
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
 * the application entry point; provider reconciliation must explicitly opt in.
 */
export class ProviderReconciliationWorker {
  private recentTimer: ReturnType<typeof setInterval> | undefined;
  private fullTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly intake: ProviderReconciliationIntake | ProviderReconciliationIntake[],
    private readonly intervals: { recentMs: number; fullMs: number; recentLimit?: number; runFullOnStart?: boolean },
  ) {}

  private intakes(): ProviderReconciliationIntake[] { return Array.isArray(this.intake) ? this.intake : [this.intake]; }
  async runRecent(): Promise<DirectFileEvent[]> { return (await Promise.all(this.intakes().map((intake) => intake.reconcile('recent', this.intervals.recentLimit || 30)))).flat(); }
  async runFull(): Promise<DirectFileEvent[]> { return (await Promise.all(this.intakes().map((intake) => intake.reconcile('full')))).flat(); }

  start(): void {
    if (this.recentTimer || this.fullTimer) return;
    this.runRecent().catch(() => undefined);
    if (this.intervals.runFullOnStart !== false) this.runFull().catch(() => undefined);
    this.recentTimer = setInterval(() => { this.runRecent().catch(() => undefined); }, this.intervals.recentMs);
    this.fullTimer = setInterval(() => { this.runFull().catch(() => undefined); }, this.intervals.fullMs);
  }

  stop(): void {
    if (this.recentTimer) clearInterval(this.recentTimer);
    if (this.fullTimer) clearInterval(this.fullTimer);
    this.recentTimer = undefined;
    this.fullTimer = undefined;
  }

  isRunning(): boolean {
    return !!this.recentTimer || !!this.fullTimer;
  }
}
