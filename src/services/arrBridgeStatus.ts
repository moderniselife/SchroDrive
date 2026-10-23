interface Submission { provider: string; id: string; success: boolean }
interface TrackedStatus {
  name: string;
  state: string;
  mountScanned: boolean;
  providerResults: Submission[];
}
interface ProviderStatus { provider: string; id: string; name: string }

export interface ProviderInventory<T extends ProviderStatus> {
  provider: string;
  items: T[];
  /** False when the provider response was unavailable or incomplete. */
  complete: boolean;
}

export interface ProviderLookup<T extends ProviderStatus> {
  match?: T;
  /** True only when the submitted provider returned a complete inventory. */
  authoritativeMissing: boolean;
}

/** Retry accepted submissions, including old persisted missing-provider errors. */
export function shouldPollTorrent(torrent: TrackedStatus): boolean {
  return !torrent.mountScanned && (
    ['downloading', 'stalledDL', 'queuedDL'].includes(torrent.state) ||
    (torrent.state === 'error' && torrent.providerResults.some(r => r.success && r.id))
  );
}

/** Provider IDs are scoped to a provider, and survive release-name changes. */
export function findProviderTorrent<T extends ProviderStatus>(torrent: TrackedStatus, inventory: T[]): T | undefined {
  const inventories = [...new Set(inventory.map(item => item.provider))]
    .map(provider => ({
      provider,
      items: inventory.filter(item => item.provider === provider),
      complete: true,
    }));
  return findProviderTorrentWithStatus(torrent, inventories).match;
}

/**
 * Resolve a tracked torrent without treating an incomplete inventory as proof
 * that the provider deleted it.
 */
export function findProviderTorrentWithStatus<T extends ProviderStatus>(
  torrent: TrackedStatus,
  inventories: ProviderInventory<T>[],
): ProviderLookup<T> {
  const submissions = torrent.providerResults.filter(r => r.success && r.id);

  // First search every complete inventory. A later provider may still contain
  // the torrent even when an earlier provider response is incomplete.
  for (const submission of submissions) {
    const inventory = inventories.find(i => i.provider === submission.provider);
    if (!inventory?.complete) continue;
    const match = inventory.items.find(t => t.provider === submission.provider && t.id === String(submission.id));
    if (match) return { match, authoritativeMissing: false };
  }

  // Only a complete response for the submitted provider can prove deletion.
  if (submissions.some(submission => inventories.some(i =>
    i.provider === submission.provider && i.complete &&
    !i.items.some(t => t.provider === submission.provider && t.id === String(submission.id))
  ))) {
    return { authoritativeMissing: true };
  }

  // Do not substitute a similarly named release for a known provider ID.
  if (submissions.length) return { authoritativeMissing: false };
  const normalize = (name: string) => name.toLowerCase().replace(/[.\-_\s]+/g, ' ').trim();
  const name = normalize(torrent.name);
  if (!name) return { authoritativeMissing: false };
  const matches = inventories
    .filter(i => i.complete)
    .flatMap(i => i.items)
    .filter(t => normalize(t.name) === name);
  return { match: matches.length === 1 ? matches[0] : undefined, authoritativeMissing: false };
}
