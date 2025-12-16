import { Command } from "commander";
import { startServer } from "./server";
import { searchIndexer, pickBestResult, getMagnet, getProviderName } from "./indexer";
import { addMagnetToTorbox } from "./torbox";
import { mountVirtualDrive } from "./mount";
import { scanDeadOnce, startDeadScanner } from "./deadScanner";
import { organizeOnce, startOrganizerWatch } from "./organizer";
import { config } from "./config";

const program = new Command();
program
  .name("schrodrive")
  .description("CLI/Webhook tool to integrate Overseerr with Prowlarr/Jackett and TorBox (plus API poller mode)")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the webhook HTTP server")
  .action(async () => {
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
    
    // Start the main server
    startServer();
    
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
  .description("Add a torrent magnet to TorBox; if --query is provided, search indexer and add the best magnet")
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

    const added = await addMagnetToTorbox(magnet, chosen?.title);
    console.log(JSON.stringify({ ok: true, chosen, torbox: added }, null, 2));
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
