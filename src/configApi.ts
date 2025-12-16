import * as fs from "fs";
import * as path from "path";

// All configurable environment variables with their metadata
export const CONFIG_SCHEMA = {
  // General
  PORT: { type: "number", default: "8978", category: "general", label: "Server Port" },
  PROVIDERS: { type: "string", default: "torbox,realdebrid", category: "general", label: "Active Providers" },

  // Indexer Selection
  INDEXER_PROVIDER: { type: "select", default: "auto", options: ["auto", "jackett", "prowlarr"], category: "indexers", label: "Indexer Provider" },

  // Jackett
  JACKETT_URL: { type: "string", default: "", category: "indexers", label: "Jackett URL" },
  JACKETT_API_KEY: { type: "password", default: "", category: "indexers", label: "Jackett API Key" },
  JACKETT_CATEGORIES: { type: "string", default: "", category: "indexers", label: "Jackett Categories" },
  JACKETT_INDEXER_IDS: { type: "string", default: "", category: "indexers", label: "Jackett Indexer IDs" },
  JACKETT_SEARCH_LIMIT: { type: "number", default: "100", category: "indexers", label: "Jackett Search Limit" },
  JACKETT_TIMEOUT_MS: { type: "number", default: "120000", category: "indexers", label: "Jackett Timeout (ms)" },
  JACKETT_REDIRECT_MAX_HOPS: { type: "number", default: "5", category: "indexers", label: "Jackett Max Redirect Hops" },

  // Prowlarr
  PROWLARR_URL: { type: "string", default: "", category: "indexers", label: "Prowlarr URL" },
  PROWLARR_API_KEY: { type: "password", default: "", category: "indexers", label: "Prowlarr API Key" },
  PROWLARR_CATEGORIES: { type: "string", default: "", category: "indexers", label: "Prowlarr Categories" },
  PROWLARR_INDEXER_IDS: { type: "string", default: "", category: "indexers", label: "Prowlarr Indexer IDs" },
  PROWLARR_SEARCH_LIMIT: { type: "number", default: "100", category: "indexers", label: "Prowlarr Search Limit" },
  PROWLARR_TIMEOUT_MS: { type: "number", default: "120000", category: "indexers", label: "Prowlarr Timeout (ms)" },
  PROWLARR_REDIRECT_MAX_HOPS: { type: "number", default: "5", category: "indexers", label: "Prowlarr Max Redirect Hops" },

  // TorBox
  TORBOX_API_KEY: { type: "password", default: "", category: "torbox", label: "TorBox API Key" },
  TORBOX_BASE_URL: { type: "string", default: "https://api.torbox.app", category: "torbox", label: "TorBox Base URL" },
  TORBOX_WEBDAV_URL: { type: "string", default: "https://webdav.torbox.app", category: "torbox", label: "TorBox WebDAV URL" },
  TORBOX_WEBDAV_USERNAME: { type: "string", default: "", category: "torbox", label: "TorBox WebDAV Username" },
  TORBOX_WEBDAV_PASSWORD: { type: "password", default: "", category: "torbox", label: "TorBox WebDAV Password" },

  // Real-Debrid
  RD_ACCESS_TOKEN: { type: "password", default: "", category: "realdebrid", label: "Real-Debrid Access Token" },
  RD_API_BASE: { type: "string", default: "https://api.real-debrid.com/rest/1.0", category: "realdebrid", label: "Real-Debrid API Base" },
  RD_WEBDAV_URL: { type: "string", default: "https://dav.real-debrid.com", category: "realdebrid", label: "Real-Debrid WebDAV URL" },
  RD_WEBDAV_USERNAME: { type: "string", default: "", category: "realdebrid", label: "Real-Debrid WebDAV Username" },
  RD_WEBDAV_PASSWORD: { type: "password", default: "", category: "realdebrid", label: "Real-Debrid WebDAV Password" },

  // Overseerr
  OVERSEERR_URL: { type: "string", default: "", category: "overseerr", label: "Overseerr URL" },
  OVERSEERR_API_KEY: { type: "password", default: "", category: "overseerr", label: "Overseerr API Key" },
  OVERSEERR_AUTH: { type: "password", default: "", category: "overseerr", label: "Webhook Auth Header" },
  POLL_INTERVAL_S: { type: "number", default: "30", category: "overseerr", label: "Poll Interval (seconds)" },

  // Runtime Services
  RUN_WEBHOOK: { type: "boolean", default: "true", category: "services", label: "Run Webhook Server" },
  RUN_POLLER: { type: "boolean", default: "false", category: "services", label: "Run Overseerr Poller" },
  RUN_MOUNT: { type: "boolean", default: "false", category: "services", label: "Auto-Mount WebDAV" },
  RUN_DEAD_SCANNER: { type: "boolean", default: "false", category: "services", label: "Run Dead Scanner" },
  RUN_DEAD_SCANNER_WATCH: { type: "boolean", default: "false", category: "services", label: "Dead Scanner Watch Mode" },
  RUN_ORGANIZER_WATCH: { type: "boolean", default: "false", category: "services", label: "Organizer Watch Mode" },

  // Mount Settings
  MOUNT_BASE: { type: "string", default: "/mnt/schrodrive", category: "mounts", label: "Mount Base Path" },
  RCLONE_PATH: { type: "string", default: "rclone", category: "mounts", label: "Rclone Path" },
  MOUNT_OPTIONS: { type: "string", default: "--vfs-cache-mode=full --dir-cache-time=12h --poll-interval=0 --buffer-size=64M", category: "mounts", label: "Mount Options" },
  MOUNT_ALLOW_OTHER: { type: "boolean", default: "true", category: "mounts", label: "Allow Other Users" },
  MOUNT_UID: { type: "number", default: "", category: "mounts", label: "Mount UID" },
  PUID: { type: "number", default: "", category: "mounts", label: "PUID (alias for UID)" },
  MOUNT_GID: { type: "number", default: "", category: "mounts", label: "Mount GID" },
  PGID: { type: "number", default: "", category: "mounts", label: "PGID (alias for GID)" },
  MOUNT_DIR_PERMS: { type: "string", default: "", category: "mounts", label: "Directory Permissions" },
  MOUNT_FILE_PERMS: { type: "string", default: "", category: "mounts", label: "File Permissions" },
  MOUNT_VFS_CACHE_MODE: { type: "select", default: "full", options: ["off", "minimal", "writes", "full"], category: "mounts", label: "VFS Cache Mode" },
  MOUNT_DIR_CACHE_TIME: { type: "string", default: "12h", category: "mounts", label: "Dir Cache Time" },
  MOUNT_POLL_INTERVAL: { type: "string", default: "0", category: "mounts", label: "Poll Interval" },
  MOUNT_BUFFER_SIZE: { type: "string", default: "64M", category: "mounts", label: "Buffer Size" },
  MOUNT_VFS_READ_CHUNK_SIZE: { type: "string", default: "", category: "mounts", label: "VFS Read Chunk Size" },
  MOUNT_VFS_READ_CHUNK_SIZE_LIMIT: { type: "string", default: "", category: "mounts", label: "VFS Read Chunk Size Limit" },
  MOUNT_VFS_CACHE_MAX_AGE: { type: "string", default: "", category: "mounts", label: "VFS Cache Max Age" },
  MOUNT_VFS_CACHE_MAX_SIZE: { type: "string", default: "", category: "mounts", label: "VFS Cache Max Size" },

  // Dead Scanner
  DEAD_SCAN_INTERVAL_S: { type: "number", default: "600", category: "services", label: "Dead Scan Interval (seconds)" },
  DEAD_IDLE_MIN: { type: "number", default: "120", category: "services", label: "Dead Idle Threshold (minutes)" },

  // Organizer
  TMDB_API_KEY: { type: "password", default: "", category: "organizer", label: "TMDB API Key" },
  ORGANIZED_BASE: { type: "string", default: "", category: "organizer", label: "Organized Base Path" },
  ORGANIZER_MODE: { type: "select", default: "symlink", options: ["symlink", "copy", "move"], category: "organizer", label: "Organizer Mode" },
  ORG_SCAN_INTERVAL_S: { type: "number", default: "300", category: "organizer", label: "Organizer Scan Interval (seconds)" },

  // Auto-Update
  AUTO_UPDATE_ENABLED: { type: "boolean", default: "false", category: "updates", label: "Enable Auto-Update" },
  AUTO_UPDATE_INTERVAL_S: { type: "number", default: "3600", category: "updates", label: "Update Check Interval (seconds)" },
  AUTO_UPDATE_STRATEGY: { type: "select", default: "exit", options: ["exit", "git"], category: "updates", label: "Update Strategy" },
  REPO_OWNER: { type: "string", default: "moderniselife", category: "updates", label: "Repository Owner" },
  REPO_NAME: { type: "string", default: "SchroDrive", category: "updates", label: "Repository Name" },
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;

interface ConfigValue {
  value: string;
  source: "env" | "file" | "default";
  schema: (typeof CONFIG_SCHEMA)[ConfigKey];
}

export type ConfigData = Record<ConfigKey, ConfigValue>;

// Find the .env file path
function findEnvPath(): string {
  // Check multiple possible locations
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
    "/app/.env", // Docker container path
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Default to cwd
  return path.join(process.cwd(), ".env");
}

// Parse .env file into a map
function parseEnvFile(filePath: string): Map<string, string> {
  const result = new Map<string, string>();

  if (!fs.existsSync(filePath)) {
    return result;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result.set(key, value);
  }

  return result;
}

// Get all config values with their sources
export function getConfigWithSources(): { config: ConfigData; envPath: string } {
  const envPath = findEnvPath();
  const fileValues = parseEnvFile(envPath);
  const config: Partial<ConfigData> = {};

  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const k = key as ConfigKey;
    const envValue = process.env[key];
    const fileValue = fileValues.get(key);

    let value: string;
    let source: "env" | "file" | "default";

    if (envValue !== undefined && envValue !== "") {
      // Runtime environment variable takes priority
      value = envValue;
      source = "env";
    } else if (fileValue !== undefined) {
      // .env file value
      value = fileValue;
      source = "file";
    } else {
      // Default value
      value = schema.default;
      source = "default";
    }

    config[k] = {
      value,
      source,
      schema,
    };
  }

  return { config: config as ConfigData, envPath };
}

// Save config to .env file
export function saveConfigToFile(updates: Record<string, string>): { success: boolean; error?: string; path: string } {
  const envPath = findEnvPath();

  try {
    // Read existing file content or create from template
    let existingContent = "";
    const examplePath = path.join(path.dirname(envPath), ".env.example");

    if (fs.existsSync(envPath)) {
      existingContent = fs.readFileSync(envPath, "utf-8");
    } else if (fs.existsSync(examplePath)) {
      // Use .env.example as template
      existingContent = fs.readFileSync(examplePath, "utf-8");
    }

    // Parse existing content to preserve comments and structure
    const lines = existingContent.split("\n");
    const updatedKeys = new Set<string>();
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Keep comments and empty lines as-is
      if (!trimmed || trimmed.startsWith("#")) {
        // Check if this is a commented-out config line that we're updating
        const commentedMatch = trimmed.match(/^#\s*([A-Z_]+)=/);
        if (commentedMatch && updates[commentedMatch[1]] !== undefined) {
          const key = commentedMatch[1];
          const newValue = updates[key];
          // Uncomment and update the value
          if (newValue !== "") {
            newLines.push(`${key}=${newValue}`);
            updatedKeys.add(key);
          } else {
            newLines.push(line); // Keep commented if value is empty
          }
        } else {
          newLines.push(line);
        }
        continue;
      }

      // Parse active config line
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) {
        newLines.push(line);
        continue;
      }

      const key = trimmed.substring(0, eqIndex).trim();

      if (updates[key] !== undefined) {
        // Update this key
        const newValue = updates[key];
        if (newValue !== "") {
          newLines.push(`${key}=${newValue}`);
        } else {
          // Comment out if value is empty
          newLines.push(`# ${key}=`);
        }
        updatedKeys.add(key);
      } else {
        // Keep existing value
        newLines.push(line);
      }
    }

    // Add any new keys that weren't in the file
    for (const [key, value] of Object.entries(updates)) {
      if (!updatedKeys.has(key) && value !== "") {
        newLines.push(`${key}=${value}`);
      }
    }

    // Write the updated content
    fs.writeFileSync(envPath, newLines.join("\n"));

    return { success: true, path: envPath };
  } catch (err: any) {
    return { success: false, error: err.message, path: envPath };
  }
}

// Check if running in Docker
export function isRunningInDocker(): boolean {
  try {
    // Check for .dockerenv file
    if (fs.existsSync("/.dockerenv")) return true;

    // Check cgroup
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf-8");
    return cgroup.includes("docker") || cgroup.includes("kubepods");
  } catch {
    return false;
  }
}

// Trigger container restart (for Docker)
export function triggerRestart(): { success: boolean; message: string } {
  if (isRunningInDocker()) {
    // In Docker, we exit and let the restart policy handle it
    console.log(`[${new Date().toISOString()}][config] Triggering restart by exiting process...`);
    setTimeout(() => process.exit(0), 500);
    return { success: true, message: "Container will restart shortly" };
  } else {
    return { success: false, message: "Not running in Docker. Restart manually." };
  }
}
