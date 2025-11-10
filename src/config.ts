export const config = {
  port: Number(process.env.PORT || 8978),
  prowlarrUrl: process.env.PROWLARR_URL || "",
  prowlarrApiKey: process.env.PROWLARR_API_KEY || "",
  prowlarrCategories: (process.env.PROWLARR_CATEGORIES || "").split(",").filter(Boolean),
  torboxApiKey: process.env.TORBOX_API_KEY || "",
  torboxBaseUrl: process.env.TORBOX_BASE_URL || "https://api.torbox.app",
  overseerrAuth: process.env.OVERSEERR_AUTH || "",
  // Overseerr API (poller) configuration
  overseerrUrl: process.env.OVERSEERR_URL || "",
  overseerrApiKey: process.env.OVERSEERR_API_KEY || "",
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_S || 30),
  // Runtime toggles
  runWebhook: String(process.env.RUN_WEBHOOK ?? "true").toLowerCase() !== "false",
  runPoller: String(process.env.RUN_POLLER ?? "false").toLowerCase() === "true",
  // Auto-update
  autoUpdateEnabled: String(process.env.AUTO_UPDATE_ENABLED ?? "false").toLowerCase() === "true",
  autoUpdateIntervalSeconds: Number(process.env.AUTO_UPDATE_INTERVAL_S || 3600),
  autoUpdateStrategy: (process.env.AUTO_UPDATE_STRATEGY || "exit") as "exit" | "git",
  repoOwner: process.env.REPO_OWNER || "moderniselife",
  repoName: process.env.REPO_NAME || "SchroDrive",
};

export function requireEnv(...keys: (keyof typeof config)[]) {
    const missing = keys.filter((k) => !String(config[k] || "").trim());
    if (missing.length) {
        throw new Error(
            `Missing required configuration: ${missing.join(", ")}. Set environment variables accordingly.`
        );
    }
}
