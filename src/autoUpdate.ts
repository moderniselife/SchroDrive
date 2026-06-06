import axios from "axios";
import { exec } from "child_process";
import { config } from "./config";
// Importing JSON is supported by tsconfig (resolveJsonModule)
// This resolves at runtime to projectRoot/package.json from dist
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pkg from "../package.json";

function parseSemver(v: string): [number, number, number] {
  const s = String(v || "").trim().replace(/^v/i, "").split("-")[0];
  const parts = s.split(".");
  const major = Number(parts[0] || 0) || 0;
  const minor = Number(parts[1] || 0) || 0;
  const patch = Number(parts[2] || 0) || 0;
  return [major, minor, patch];
}

function isNewer(a: string, b: string): boolean {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

async function getLatestTag(owner: string, repo: string): Promise<string | undefined> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const started = Date.now();
    const res = await axios.get(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "schrodrive-updater",
      },
      timeout: 10000,
    });
    const tag = res?.data?.tag_name || res?.data?.tagName || res?.data?.name;
    console.log(`[${new Date().toISOString()}][auto-update] latest release`, { url, tag, ms: Date.now() - started });
    return typeof tag === "string" ? tag : undefined;
  } catch (e: any) {
    console.warn(`[${new Date().toISOString()}][auto-update] failed to fetch latest tag`, e?.message || String(e));
    return undefined;
  }
}

function doExitRestart(reason: string) {
  console.log(`[${new Date().toISOString()}][auto-update] ${reason} -> exiting for supervisor/docker to restart`);
  setTimeout(() => process.exit(0), 500);
}

function tryGitPullAndExit() {
  console.log(`[${new Date().toISOString()}][auto-update] attempting git pull --ff-only`);
  exec("git pull --ff-only", (err, stdout, stderr) => {
    if (err) {
      console.warn(`[${new Date().toISOString()}][auto-update] git pull failed, exiting anyway`, err.message || String(err));
      doExitRestart("git pull failed");
      return;
    }
    console.log(`[${new Date().toISOString()}][auto-update] git pull ok`, { stdout: stdout?.trim(), stderr: stderr?.trim() });
    doExitRestart("git pull ok");
  });
}

export function startAutoUpdater() {
  if (!config.autoUpdateEnabled) return;
  const owner = config.repoOwner;
  const repo = config.repoName;
  const current = String(pkg?.version || "0.0.0");
  const intervalMs = Math.max(60, Number(config.autoUpdateIntervalSeconds || 3600)) * 1000;

  console.log(`[${new Date().toISOString()}][auto-update] enabled`, {
    owner,
    repo,
    current,
    strategy: config.autoUpdateStrategy,
    everySeconds: Math.round(intervalMs / 1000),
  });

  let firstCheck = true;

  const check = async () => {
    try {
      const latestTag = await getLatestTag(owner, repo);
      if (!latestTag) return;
      const latest = latestTag.replace(/^v/i, "");
      if (isNewer(latest, current)) {
        console.log(`[${new Date().toISOString()}][auto-update] update available`, { current, latest: latestTag, strategy: config.autoUpdateStrategy });
        if (config.autoUpdateStrategy === "git") {
          tryGitPullAndExit();
        } else {
          doExitRestart("new version available");
        }
      } else {
        if (firstCheck) {
          console.log(`[${new Date().toISOString()}][auto-update] first check: up to date`, { current, latest: latestTag });
        }
      }
    } catch (e: any) {
      console.warn(`[${new Date().toISOString()}][auto-update] check failed`, e?.message || String(e));
    }
    firstCheck = false;
  };

  // Run first check immediately, then schedule interval
  check();
  setInterval(check, intervalMs);
}
