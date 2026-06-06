import { Command } from "commander";
import { startServer } from "./server";
import { searchIndexer, pickBestResult, getMagnet, getProviderName } from "./indexers/index";
import { registry } from "./providers";
import { mountVirtualDrive, unmountAll } from "./services/mount";
import { scanDeadOnce, startDeadScanner } from "./services/deadScanner";
import { organizeOnce, startOrganizerWatch } from "./services/organizer";
import { startWatchlistPoller } from "./services/mediaServerWatchlist";
import { startStremioAddonServer } from "./services/stremioAddon";
import { config } from "./core/config";
import { getDb, closeDb, pruneOldEntries } from "./core/db";

const program = new Command();
program
  .name("schrodrive")
  .description("CLI/Webhook tool to integrate Overseerr with Prowlarr/Jackett and debrid providers (plus API poller mode)")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the webhook HTTP server")
  .action(async () => {
    // Initialise SQLite database early in the startup sequence
    try {
      getDb();
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][serve] Database initialisation failed (non-fatal): ${err?.message}`);
    }

    // Register graceful shutdown handlers
    const shutdown = () => {
      console.log(`[${new Date().toISOString()}][serve] Shutting down — unmounting FUSE drives and closing database...`);
      try {
        unmountAll();
      } catch (err: any) {
        console.error(`[${new Date().toISOString()}][serve] Error during FUSE unmount (non-fatal): ${err?.message}`);
      }
      closeDb();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Schedule database pruning every 24 hours
    const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
      try {
        pruneOldEntries();
      } catch (err: any) {
        console.error(`[${new Date().toISOString()}][serve] Scheduled prune failed: ${err?.message}`);
      }
    }, PRUNE_INTERVAL_MS);

    // Start additional services if enabled via environment variables
    const promises: Promise<void>[] = [];
    
    if (config.runMount) {
      console.log("[serve] Starting virtual drive mount (RUN_MOUNT=true)");
      promises.push(mountVirtualDrive());
    }
    
    if (config.runDeadScannerWatch) {
      console.log("[serve] Starting dead scanner watch (RUN_DEAD_SCANNER_WATCH=true)");
      promises.push(Promise.resolve(startDeadScanner()));
    } else if (config.runDeadScanner) {
      console.log("[serve] Running dead scanner once (RUN_DEAD_SCANNER=true)");
      promises.push(scanDeadOnce().then(() => {}));
    }

    if (config.runOrganizerWatch) {
      console.log("[serve] Starting organizer watch (RUN_ORGANIZER_WATCH=true)");
      promises.push(Promise.resolve(startOrganizerWatch()));
    }

    if (config.runWatchlistPoller) {
      console.log("[serve] Starting media server watchlist poller (RUN_WATCHLIST_POLLER=true)");
      startWatchlistPoller();
    }
    
    // Start the main server
    startServer();

    // Start Stremio addon server (separate port)
    startStremioAddonServer();
    
    // If additional services are running, handle their errors
    if (promises.length > 0) {
      Promise.allSettled(promises).then(results => {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(`[serve] Additional service ${index} failed:`, result.reason);
          }
        });
      });
    }
  });

program
  .command("mount")
  .description("Mount configured WebDAV providers (TorBox/Real-Debrid) via rclone")
  .action(async () => {
    await mountVirtualDrive();
  });

program
  .command("search")
  .description("Search indexer (Prowlarr/Jackett) for a query and print the best result")
  .argument("<query>", "Search terms")
  .option("-c, --categories <catComma>", "Comma separated category IDs")
  .option("-i, --indexer-ids <idsComma>", "Comma separated indexer IDs")
  .option("-l, --limit <n>", "Limit results", (v) => parseInt(v, 10))
  .action(async (query: string, opts: any) => {
    const categories = (opts.categories ? String(opts.categories).split(",").filter(Boolean) : undefined);
    const indexerIds = (opts.indexerIds ? String(opts.indexerIds).split(",").filter(Boolean) : undefined);
    const limit = opts.limit && Number.isFinite(opts.limit) ? Number(opts.limit) : undefined;

    const results = await searchIndexer(query, { categories, indexerIds, limit });
    const best = pickBestResult(results);
    const provider = getProviderName();
    console.log(JSON.stringify({ query, provider, best, resultsCount: results.length }, null, 2));
  });

program
  .command("add")
  .description("Add a torrent magnet to configured debrid providers; if --query is provided, search indexer and add the best magnet")
  .option("-m, --magnet <magnet>", "Magnet URI to add")
  .option("-q, --query <query>", "Query to search in indexer; best result will be added")
  .action(async (opts: any) => {
    if (!opts.magnet && !opts.query) {
      throw new Error("Provide either --magnet or --query");
    }

    let magnet: string | undefined = opts.magnet;
    let chosen: any = undefined;

    if (!magnet && opts.query) {
      const results = await searchIndexer(String(opts.query));
      chosen = pickBestResult(results);
      magnet = getMagnet(chosen);
    }

    if (!magnet) throw new Error("No magnet found");

    const { results } = await registry.addMagnetWithStrategy(magnet, chosen?.title, 'all');
    console.log(JSON.stringify({ ok: true, chosen, results }, null, 2));
  });

program
  .command("scan-dead")
  .description("Scan providers for dead torrents and attempt re-add via indexer to the opposite provider")
  .option("-w, --watch", "Run continuously on an interval")
  .action(async (opts: any) => {
    if (opts.watch) {
      startDeadScanner();
    } else {
      const res = await scanDeadOnce();
      console.log(JSON.stringify(res, null, 2));
    }
  });

program
  .command("organize")
  .description("Classify media and create a symlinked organized view under ORGANIZED_BASE")
  .option("-w, --watch", "Watch periodically and keep the organized view updated")
  .option("-n, --dry-run", "Don't create links, just log what would happen")
  .action(async (opts: any) => {
    if (opts.watch) {
      startOrganizerWatch();
    } else {
      await organizeOnce({ dryRun: !!opts.dryRun });
    }
  });

program.parseAsync(process.argv);
