"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const server_1 = require("./server");
const index_1 = require("./indexers/index");
const providers_1 = require("./providers");
const mount_1 = require("./services/mount");
const deadScanner_1 = require("./services/deadScanner");
const organizer_1 = require("./services/organizer");
const mediaServerWatchlist_1 = require("./services/mediaServerWatchlist");
const stremioAddon_1 = require("./services/stremioAddon");
const config_1 = require("./core/config");
const db_1 = require("./core/db");
const program = new commander_1.Command();
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
        (0, db_1.getDb)();
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][serve] Database initialisation failed (non-fatal): ${err?.message}`);
    }
    // Register graceful shutdown handlers
    const shutdown = () => {
        console.log(`[${new Date().toISOString()}][serve] Shutting down — unmounting FUSE drives...`);
        try {
            (0, mount_1.unmountAll)();
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][serve] Error during FUSE unmount (non-fatal): ${err?.message}`);
        }
        console.log(`[${new Date().toISOString()}][serve] Waiting 3 seconds for FUSE mounts to clear...`);
        setTimeout(() => {
            console.log(`[${new Date().toISOString()}][serve] Closing database and exiting...`);
            (0, db_1.closeDb)();
            process.exit(0);
        }, 3000);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    // Schedule database pruning every 24 hours
    const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
        try {
            (0, db_1.pruneOldEntries)();
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][serve] Scheduled prune failed: ${err?.message}`);
        }
    }, PRUNE_INTERVAL_MS);
    // Start additional services if enabled via environment variables
    const promises = [];
    if (config_1.config.runMount) {
        console.log("[serve] Starting virtual drive mount (RUN_MOUNT=true)");
        promises.push((0, mount_1.mountVirtualDrive)());
    }
    if (config_1.config.runDeadScannerWatch) {
        console.log("[serve] Starting dead scanner watch (RUN_DEAD_SCANNER_WATCH=true)");
        promises.push(Promise.resolve((0, deadScanner_1.startDeadScanner)()));
    }
    else if (config_1.config.runDeadScanner) {
        console.log("[serve] Running dead scanner once (RUN_DEAD_SCANNER=true)");
        promises.push((0, deadScanner_1.scanDeadOnce)().then(() => { }));
    }
    if (config_1.config.runOrganizerWatch) {
        console.log("[serve] Starting organizer watch (RUN_ORGANIZER_WATCH=true)");
        promises.push(Promise.resolve((0, organizer_1.startOrganizerWatch)()));
    }
    if (config_1.config.runWatchlistPoller) {
        console.log("[serve] Starting media server watchlist poller (RUN_WATCHLIST_POLLER=true)");
        (0, mediaServerWatchlist_1.startWatchlistPoller)();
    }
    // Start the main server
    (0, server_1.startServer)();
    // Start Stremio addon server (separate port)
    (0, stremioAddon_1.startStremioAddonServer)();
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
    await (0, mount_1.mountVirtualDrive)();
});
program
    .command("search")
    .description("Search indexer (Prowlarr/Jackett) for a query and print the best result")
    .argument("<query>", "Search terms")
    .option("-c, --categories <catComma>", "Comma separated category IDs")
    .option("-i, --indexer-ids <idsComma>", "Comma separated indexer IDs")
    .option("-l, --limit <n>", "Limit results", (v) => parseInt(v, 10))
    .action(async (query, opts) => {
    const categories = (opts.categories ? String(opts.categories).split(",").filter(Boolean) : undefined);
    const indexerIds = (opts.indexerIds ? String(opts.indexerIds).split(",").filter(Boolean) : undefined);
    const limit = opts.limit && Number.isFinite(opts.limit) ? Number(opts.limit) : undefined;
    const results = await (0, index_1.searchIndexer)(query, { categories, indexerIds, limit });
    const best = (0, index_1.pickBestResult)(results);
    const provider = (0, index_1.getProviderName)();
    console.log(JSON.stringify({ query, provider, best, resultsCount: results.length }, null, 2));
});
program
    .command("add")
    .description("Add a torrent magnet to configured debrid providers; if --query is provided, search indexer and add the best magnet")
    .option("-m, --magnet <magnet>", "Magnet URI to add")
    .option("-q, --query <query>", "Query to search in indexer; best result will be added")
    .action(async (opts) => {
    if (!opts.magnet && !opts.query) {
        throw new Error("Provide either --magnet or --query");
    }
    let magnet = opts.magnet;
    let chosen = undefined;
    if (!magnet && opts.query) {
        const results = await (0, index_1.searchIndexer)(String(opts.query));
        chosen = (0, index_1.pickBestResult)(results);
        magnet = (0, index_1.getMagnet)(chosen);
    }
    if (!magnet)
        throw new Error("No magnet found");
    const { results } = await providers_1.registry.addMagnetWithStrategy(magnet, chosen?.title, 'all');
    console.log(JSON.stringify({ ok: true, chosen, results }, null, 2));
});
program
    .command("scan-dead")
    .description("Scan providers for dead torrents and attempt re-add via indexer to the opposite provider")
    .option("-w, --watch", "Run continuously on an interval")
    .action(async (opts) => {
    if (opts.watch) {
        (0, deadScanner_1.startDeadScanner)();
    }
    else {
        const res = await (0, deadScanner_1.scanDeadOnce)();
        console.log(JSON.stringify(res, null, 2));
    }
});
program
    .command("organize")
    .description("Classify media and create a symlinked organized view under ORGANIZED_BASE")
    .option("-w, --watch", "Watch periodically and keep the organized view updated")
    .option("-n, --dry-run", "Don't create links, just log what would happen")
    .action(async (opts) => {
    if (opts.watch) {
        (0, organizer_1.startOrganizerWatch)();
    }
    else {
        await (0, organizer_1.organizeOnce)({ dryRun: !!opts.dryRun });
    }
});
program.parseAsync(process.argv);
