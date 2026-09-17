import { describe, expect, test } from 'bun:test';
import { assessReconciliationCapabilities, type ReconciliationCapabilities } from '../../../src/services/providerReconciliationCapabilities';

const alldebrid: ReconciliationCapabilities = {
  statusList: true, fileTree: true, recentSnapshot: true, fullSnapshot: true,
  changeDetection: true, pushEvents: false,
};

describe('provider reconciliation capability matrix', () => {
  test('enables AllDebrid polling with recent/full snapshot diff and no push dependency', () => {
    const assessment = assessReconciliationCapabilities(alldebrid);
    expect(assessment.mode).toBe('polling');
    expect(assessment.capabilities.changeDetection).toBe(true);
    expect(assessment.capabilities.pushEvents).toBe(false);
  });

  test('uses explicit full-poll fallback when recent listing is unavailable', () => {
    const assessment = assessReconciliationCapabilities({ ...alldebrid, recentSnapshot: false });
    expect(assessment.mode).toBe('polling');
    expect(assessment.capabilities.recentSnapshot).toBe(false);
    expect(assessment.reason).toContain('recent polling is unavailable');
  });

  test('selects push-only mode only when the provider declares push events', () => {
    const assessment = assessReconciliationCapabilities({
      statusList: false, fileTree: false, recentSnapshot: false, fullSnapshot: false,
      changeDetection: false, pushEvents: true,
    });
    expect(assessment.mode).toBe('push');
    expect(assessment.capabilities.changeDetection).toBe(false);
  });

  test('disables reconciliation when a provider has no complete snapshot or push contract', () => {
    const assessment = assessReconciliationCapabilities({
      statusList: true, fileTree: false, recentSnapshot: true, fullSnapshot: false,
      changeDetection: true, pushEvents: false,
    });
    expect(assessment.mode).toBe('disabled');
    expect(assessment.reason).toContain('neither');
  });
});
