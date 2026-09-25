import { config } from "../core/config";
import { registry } from "../providers";
import { AllDebridProvider } from "../providers/alldebrid";
import { parseMediaFilename } from "./mediaParser";
import { recordOrganizerReview } from "./organizerReview";
import {
  AllDebridProviderSource,
  CineCircleAllDebridIntake,
  CineCircleAllDebridReconciliationWorker,
  HttpArrClient,
  SqliteIntakeStateStore,
  type ArrRoute,
} from "./cinecircleAlldebridIntake";

export function cineCircleReconciliationRoutes(): { movies: ArrRoute; shows: ArrRoute } {
  return {
    movies: { kind: "radarr", baseUrl: config.cineCircleRadarrUrl, apiKey: config.cineCircleRadarrApiKey, sourcePathPrefix: config.cineCircleAlldebridArrPath, importMode: config.cineCircleAlldebridArrImportMode === "Move" ? "Move" : "Copy", symlinkLibraryPath: config.cineCircleAlldebridMoviesLibraryPath || undefined },
    shows: { kind: "sonarr", baseUrl: config.cineCircleSonarrUrl, apiKey: config.cineCircleSonarrApiKey, sourcePathPrefix: config.cineCircleAlldebridArrPath, importMode: config.cineCircleAlldebridArrImportMode === "Move" ? "Move" : "Copy", symlinkLibraryPath: config.cineCircleAlldebridShowsLibraryPath || undefined },
  };
}

/** Builds the opt-in direct AllDebrid worker without changing provider lifecycle services. */
export function createCineCircleAllDebridReconciliationWorker(): CineCircleAllDebridReconciliationWorker | undefined {
  const provider = registry.get("alldebrid");
  if (!(provider instanceof AllDebridProvider)) {
    console.warn("[cinecircle-reconciliation] AllDebrid provider is not registered; worker disabled");
    return undefined;
  }
  if (!provider.isConfigured()) {
    console.warn("[cinecircle-reconciliation] AllDebrid credentials are not configured; worker disabled");
    return undefined;
  }

  const routes = cineCircleReconciliationRoutes();
  if (!routes.movies.baseUrl || !routes.movies.apiKey || !routes.shows.baseUrl || !routes.shows.apiKey) {
    console.warn("[cinecircle-reconciliation] Radarr/Sonarr routes are incomplete; worker disabled");
    return undefined;
  }

  const source = new AllDebridProviderSource(provider);
  const arr = new HttpArrClient();
  const store = new SqliteIntakeStateStore();
  const intake = new CineCircleAllDebridIntake(source, arr, store, {
    dryRun: config.cineCircleAlldebridDryRun,
    routeFor: (category) => category === "Movies" ? routes.movies : routes.shows,
    onReview: async (event, error) => {
      const parsed = parseMediaFilename(event.path, event.path);
      recordOrganizerReview(event.path, {
        ...parsed,
        status: parsed.status === "matched" ? "ambiguous" : parsed.status,
        reason: `AllDebrid direct intake: ${error.message}`,
      });
    },
  });
  return new CineCircleAllDebridReconciliationWorker(intake, {
    recentMs: Math.max(1000, config.cineCircleAlldebridRecentIntervalMs),
    fullMs: Math.max(1000, config.cineCircleAlldebridFullIntervalMs),
    recentLimit: Math.max(1, config.cineCircleAlldebridRecentLimit),
    runFullOnStart: config.cineCircleAlldebridRunFullOnStart,
  });
}

export function startCineCircleAllDebridReconciliation(): CineCircleAllDebridReconciliationWorker | undefined {
  if (!config.cineCircleAlldebridReconciliationEnabled) {
    console.log("[cinecircle-reconciliation] disabled (CINECIRCLE_ALLDEBRID_RECONCILIATION_ENABLED=false)");
    return undefined;
  }
  const worker = createCineCircleAllDebridReconciliationWorker();
  if (!worker) return undefined;
  worker.start();
  console.log("[cinecircle-reconciliation] started; direct AllDebrid intake is read-only and provider deletion/repair is not used");
  return worker;
}
