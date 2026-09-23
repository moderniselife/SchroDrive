import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Keep defaults — static assets are auto-handled, no custom cache or queue needed for a marketing site
});
