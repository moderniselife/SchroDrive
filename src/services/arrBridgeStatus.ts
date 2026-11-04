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

  // First search every observed item. A direct per-ID lookup can confirm one
  // submission as present while another submission for the same provider is
  // still unknown; incompleteness must block deletion, not hide a presence.
  for (const submission of submissions) {
    const inventory = inventories.find(i => i.provider === submission.provider);
    if (!inventory) continue;
    const match = inventory.items.find(t => t.provider === submission.provider && t.id === String(submission.id));
    if (match) return { match, authoritativeMissing: false };
  }

  // Only complete responses for every submitted provider can prove deletion.
  // With a multi-provider submission, one provider may be temporarily
  // unavailable while another returns a complete inventory.  The complete
  // response must not win over the incomplete one.
  const submittedProviders = [...new Set(submissions.map(submission => submission.provider))];
  const inventoriesByProvider = new Map(inventories.map(inventory => [inventory.provider, inventory]));
  const allSubmittedProvidersComplete = submittedProviders.every((provider) =>
    inventoriesByProvider.get(provider)?.complete === true,
  );
  const allSubmittedIdsMissing = submissions.every((submission) => {
    const inventory = inventoriesByProvider.get(submission.provider);
    if (!inventory) return false;
    return !inventory.items.some((item) =>
      item.provider === submission.provider && item.id === String(submission.id),
    );
  });
  if (submissions.length > 0 && allSubmittedProvidersComplete && allSubmittedIdsMissing) {
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
