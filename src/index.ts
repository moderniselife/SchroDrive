import { Command } from "commander";
import { startServer } from "./server";
import { searchProwlarr, pickBestResult, getMagnet } from "./prowlarr";
import { addMagnetToTorbox } from "./torbox";
import { mountVirtualDrive } from "./mount";
import { scanDeadOnce, startDeadScanner } from "./deadScanner";

const program = new Command();
program
  .name("schrodrive")
  .description("CLI/Webhook tool to integrate Overseerr with Prowlarr and TorBox (plus API poller mode)")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the webhook HTTP server")
  .action(() => {
    startServer();
  });

program
  .command("mount")
  .description("Mount configured WebDAV providers (TorBox/Real-Debrid) via rclone")
  .action(async () => {
    await mountVirtualDrive();
  });

program
  .command("search")
  .description("Search Prowlarr for a query and print the best result")
  .argument("<query>", "Search terms")
  .option("-c, --categories <catComma>", "Comma separated category IDs")
  .option("-i, --indexer-ids <idsComma>", "Comma separated indexer IDs")
  .option("-l, --limit <n>", "Limit results", (v) => parseInt(v, 10))
  .action(async (query: string, opts: any) => {
    const categories = (opts.categories ? String(opts.categories).split(",").filter(Boolean) : undefined);
    const indexerIds = (opts.indexerIds ? String(opts.indexerIds).split(",").filter(Boolean) : undefined);
    const limit = opts.limit && Number.isFinite(opts.limit) ? Number(opts.limit) : undefined;

    const results = await searchProwlarr(query, { categories, indexerIds, limit });
    const best = pickBestResult(results);
    console.log(JSON.stringify({ query, best, resultsCount: results.length }, null, 2));
  });

program
  .command("add")
  .description("Add a torrent magnet to TorBox; if --query is provided, search Prowlarr and add the best magnet")
  .option("-m, --magnet <magnet>", "Magnet URI to add")
  .option("-q, --query <query>", "Query to search in Prowlarr; best result will be added")
  .action(async (opts: any) => {
    if (!opts.magnet && !opts.query) {
      throw new Error("Provide either --magnet or --query");
    }

    let magnet: string | undefined = opts.magnet;
    let chosen: any = undefined;

    if (!magnet && opts.query) {
      const results = await searchProwlarr(String(opts.query));
      chosen = pickBestResult(results);
      magnet = getMagnet(chosen);
    }

    if (!magnet) throw new Error("No magnet found");

    const added = await addMagnetToTorbox(magnet, chosen?.title);
    console.log(JSON.stringify({ ok: true, chosen, torbox: added }, null, 2));
  });

program
  .command("scan-dead")
  .description("Scan providers for dead torrents and attempt re-add via Prowlarr to the opposite provider")
  .option("-w, --watch", "Run continuously on an interval")
  .action(async (opts: any) => {
    if (opts.watch) {
      startDeadScanner();
    } else {
      const res = await scanDeadOnce();
      console.log(JSON.stringify(res, null, 2));
    }
  });

program.parseAsync(process.argv);
