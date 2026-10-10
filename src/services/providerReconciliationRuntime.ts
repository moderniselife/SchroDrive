import { config } from "../core/config";
import { registry } from "../providers";
import { parseMediaFilename } from "./mediaParser";
import { recordOrganizerReview } from "./organizerReview";
import {
  ProviderSnapshotSource,
  ProviderReconciliationIntake,
  ProviderReconciliationWorker,
  HttpArrClient,
  SqliteIntakeStateStore,
  type ArrRoute,
} from "./providerReconciliation";

export function providerReconciliationRoutes(providerId = "alldebrid"): { movies: ArrRoute; shows: ArrRoute } {
  const sourcePathPrefix = `${config.providerReconciliationMountBase.replace(/\/$/, '')}/${providerId}`;
  return {
    movies: { kind: "radarr", baseUrl: config.providerReconciliationRadarrUrl, apiKey: config.providerReconciliationRadarrApiKey, sourcePathPrefix, importMode: "Copy", symlinkLibraryPath: config.providerReconciliationMoviesLibraryPath || undefined },
    shows: { kind: "sonarr", baseUrl: config.providerReconciliationSonarrUrl, apiKey: config.providerReconciliationSonarrApiKey, sourcePathPrefix, importMode: "Copy", symlinkLibraryPath: config.providerReconciliationShowsLibraryPath || undefined },
  };
}

/** Builds the opt-in provider reconciliation worker without changing provider lifecycle services. */
export function createProviderReconciliationWorker(): ProviderReconciliationWorker | undefined {
  if (!config.providerReconciliationRadarrUrl || !config.providerReconciliationRadarrApiKey || !config.providerReconciliationSonarrUrl || !config.providerReconciliationSonarrApiKey) {
    console.warn("[provider-reconciliation] Radarr/Sonarr routes are incomplete; worker disabled");
    return undefined;
  }
  const arr = new HttpArrClient();
  const store = new SqliteIntakeStateStore();
  const intakes = config.providers.flatMap((providerId) => {
    const provider = registry.get(providerId);
    if (!provider || !provider.isConfigured()) return [];
    const source = new ProviderSnapshotSource(provider);
    return [new ProviderReconciliationIntake(source, arr, store, {
      dryRun: config.providerReconciliationDryRun,
      routeFor: (category, sourceProvider) => category === "Movies" ? providerReconciliationRoutes(sourceProvider || providerId).movies : providerReconciliationRoutes(sourceProvider || providerId).shows,
      onReview: async (event, error) => {
        const parsed = parseMediaFilename(event.path, event.path);
        recordOrganizerReview(event.path, { ...parsed, status: parsed.status === "matched" ? "ambiguous" : parsed.status, reason: `Provider reconciliation (${event.provider}): ${error.message}` });
      },
    })];
  });
  if (intakes.length === 0) {
    console.warn("[provider-reconciliation] no configured providers available; worker disabled");
    return undefined;
  }
  return new ProviderReconciliationWorker(intakes, {
    recentMs: Math.max(1000, config.providerReconciliationRecentIntervalMs), fullMs: Math.max(1000, config.providerReconciliationFullIntervalMs), recentLimit: Math.max(1, config.providerReconciliationRecentLimit), runFullOnStart: config.providerReconciliationRunFullOnStart,
  });
}

export function startProviderReconciliation(): ProviderReconciliationWorker | undefined {
  if (!config.providerReconciliationEnabled) {
    console.log("[provider-reconciliation] disabled (PROVIDER_RECONCILIATION_ENABLED=false)");
    return undefined;
  }
  const worker = createProviderReconciliationWorker();
  if (!worker) return undefined;
  worker.start();
  console.log("[provider-reconciliation] started; provider intake is read-only and provider deletion/repair is not used");
  return worker;
}
