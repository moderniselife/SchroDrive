"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const server_1 = require("./server");
const prowlarr_1 = require("./prowlarr");
const torbox_1 = require("./torbox");
const mount_1 = require("./mount");
const deadScanner_1 = require("./deadScanner");
const organizer_1 = require("./organizer");
const config_1 = require("./config");
const program = new commander_1.Command();
program
    .name("schrodrive")
    .description("CLI/Webhook tool to integrate Overseerr with Prowlarr and TorBox (plus API poller mode)")
    .version("0.1.0");
program
    .command("serve")
    .description("Start the webhook HTTP server")
    .action(async () => {
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
    // Start the main server
    (0, server_1.startServer)();
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
    .description("Search Prowlarr for a query and print the best result")
    .argument("<query>", "Search terms")
    .option("-c, --categories <catComma>", "Comma separated category IDs")
    .option("-i, --indexer-ids <idsComma>", "Comma separated indexer IDs")
    .option("-l, --limit <n>", "Limit results", (v) => parseInt(v, 10))
    .action(async (query, opts) => {
    const categories = (opts.categories ? String(opts.categories).split(",").filter(Boolean) : undefined);
    const indexerIds = (opts.indexerIds ? String(opts.indexerIds).split(",").filter(Boolean) : undefined);
    const limit = opts.limit && Number.isFinite(opts.limit) ? Number(opts.limit) : undefined;
    const results = await (0, prowlarr_1.searchProwlarr)(query, { categories, indexerIds, limit });
    const best = (0, prowlarr_1.pickBestResult)(results);
    console.log(JSON.stringify({ query, best, resultsCount: results.length }, null, 2));
});
program
    .command("add")
    .description("Add a torrent magnet to TorBox; if --query is provided, search Prowlarr and add the best magnet")
    .option("-m, --magnet <magnet>", "Magnet URI to add")
    .option("-q, --query <query>", "Query to search in Prowlarr; best result will be added")
    .action(async (opts) => {
    if (!opts.magnet && !opts.query) {
        throw new Error("Provide either --magnet or --query");
    }
    let magnet = opts.magnet;
    let chosen = undefined;
    if (!magnet && opts.query) {
        const results = await (0, prowlarr_1.searchProwlarr)(String(opts.query));
        chosen = (0, prowlarr_1.pickBestResult)(results);
        magnet = (0, prowlarr_1.getMagnet)(chosen);
    }
    if (!magnet)
        throw new Error("No magnet found");
    const added = await (0, torbox_1.addMagnetToTorbox)(magnet, chosen?.title);
    console.log(JSON.stringify({ ok: true, chosen, torbox: added }, null, 2));
});
program
    .command("scan-dead")
    .description("Scan providers for dead torrents and attempt re-add via Prowlarr to the opposite provider")
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
