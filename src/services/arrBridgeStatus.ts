interface Submission { provider: string; id: string; success: boolean }
interface TrackedStatus {
  name: string;
  state: string;
  mountScanned: boolean;
  providerResults: Submission[];
}
interface ProviderStatus { provider: string; id: string; name: string }

/** Retry accepted submissions, including old persisted missing-provider errors. */
export function shouldPollTorrent(torrent: TrackedStatus): boolean {
  return !torrent.mountScanned && (
    ['downloading', 'stalledDL', 'queuedDL'].includes(torrent.state) ||
    (torrent.state === 'error' && torrent.providerResults.some(r => r.success && r.id))
  );
}

/** Provider IDs are scoped to a provider, and survive release-name changes. */
export function findProviderTorrent<T extends ProviderStatus>(torrent: TrackedStatus, inventory: T[]): T | undefined {
  const submissions = torrent.providerResults.filter(r => r.success && r.id);
  for (const submission of submissions) {
    const match = inventory.find(t => t.provider === submission.provider && t.id === String(submission.id));
    if (match) return match;
  }
  // Do not substitute a similarly named release for a known provider ID.
  if (submissions.length) return undefined;
  const normalize = (name: string) => name.toLowerCase().replace(/[.\-_\s]+/g, ' ').trim();
  const name = normalize(torrent.name);
  if (!name) return undefined;
  const matches = inventory.filter(t => normalize(t.name) === name);
  return matches.length === 1 ? matches[0] : undefined;
}
