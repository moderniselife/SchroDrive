/**
 * Provider reconciliation capability contract.
 *
 * This is intentionally descriptive only: it does not start polling or alter
 * any provider. A future generic worker can use it to opt in only when the
 * provider exposes the required read-only operations.
 */
export interface ReconciliationCapabilities {
  statusList: boolean;
  fileTree: boolean;
  recentSnapshot: boolean;
  fullSnapshot: boolean;
  changeDetection: boolean;
  pushEvents: boolean;
}

export type ReconciliationMode = 'disabled' | 'polling-hybrid' | 'polling-full-only' | 'push-only';

export interface ReconciliationCapabilityAssessment {
  capabilities: ReconciliationCapabilities;
  mode: ReconciliationMode;
  reason: string;
}

/**
 * Computes the safe mode without assuming that providers share an API.
 * Change detection is a worker-side snapshot diff and therefore requires both
 * a status listing and a file tree. Recent polling is optional; full polling
 * is the safe minimum for a polling worker.
 */
export function assessReconciliationCapabilities(
  capabilities: ReconciliationCapabilities,
): ReconciliationCapabilityAssessment {
  const hasPolling = capabilities.statusList && capabilities.fileTree && capabilities.fullSnapshot;
  const hasRecent = hasPolling && capabilities.recentSnapshot;
  const changeDetection = hasPolling && capabilities.changeDetection;
  const hasPush = capabilities.pushEvents;

  if (!hasPolling && !hasPush) {
    return { capabilities: { ...capabilities, changeDetection }, mode: 'disabled', reason: 'provider exposes neither a complete snapshot contract nor push events' };
  }
  if (hasPolling) {
    return { capabilities: { ...capabilities, recentSnapshot: hasRecent, changeDetection }, mode: hasRecent ? 'polling-hybrid' : 'polling-full-only', reason: hasRecent ? 'frequent recent polling plus periodic full polling; local snapshot diff is authoritative' : 'periodic full polling with local snapshot diff; recent polling is unavailable' };
  }
  if (hasPush) {
    return { capabilities: { ...capabilities, changeDetection }, mode: 'push-only', reason: 'provider exposes push events but not a complete polling snapshot contract' };
  }
  return { capabilities: { ...capabilities, recentSnapshot: hasRecent, changeDetection }, mode: 'polling', reason: hasRecent ? 'full/recent polling with worker-side snapshot diff is available' : 'full polling with worker-side snapshot diff is available; recent polling is unavailable' };
}
