import fs from "fs";
import path from "path";

export type FilesystemBrowserItem = {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modified?: Date;
};

export type FilesystemBrowserResult =
  | { type: "file"; path: string; name: string; size: number; modified: Date }
  | { type: "directory"; path: string; items: FilesystemBrowserItem[] };

export class FilesystemBrowserError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => setTimeout(
      () => reject(new FilesystemBrowserError(504, `Filesystem ${label} timed out`)),
      timeoutMs,
    )),
  ]);
}

/**
 * Reads a mounted filesystem without blocking Node's event loop. This matters
 * for FUSE/WebDAV mounts, where a cold or unavailable remote directory can
 * take a long time to answer a stat or readdir operation.
 */
export async function browseMountedFilesystem(
  mountBase: string,
  requestedPath: string,
  timeoutMs = 15_000,
): Promise<FilesystemBrowserResult> {
  const safePath = path.normalize(requestedPath || "/");
  const fullPath = path.resolve(mountBase, `.${safePath.startsWith("/") ? safePath : `/${safePath}`}`);
  const relativePath = path.relative(mountBase, fullPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new FilesystemBrowserError(403, "Access denied");
  }

  let stat: fs.Stats;
  try {
    stat = await withTimeout(fs.promises.stat(fullPath), "lookup", timeoutMs);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new FilesystemBrowserError(404, "Path not found");
    }
    throw err;
  }

  if (stat.isFile()) {
    return {
      type: "file",
      path: safePath,
      name: path.basename(fullPath),
      size: stat.size,
      modified: stat.mtime,
    };
  }

  const entries = await withTimeout(
    fs.promises.readdir(fullPath, { withFileTypes: true }),
    "directory listing",
    timeoutMs,
  );
  const items: FilesystemBrowserItem[] = [];

  for (const entry of entries) {
    const itemPath = path.join(fullPath, entry.name);
    try {
      const itemStat = await fs.promises.stat(itemPath);
      items.push({
        name: entry.name,
        path: path.join(safePath, entry.name),
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? itemStat.size : undefined,
        modified: itemStat.mtime,
      });
    } catch {
      items.push({
        name: entry.name,
        path: path.join(safePath, entry.name),
        type: entry.isDirectory() ? "directory" : "file",
      });
    }
  }

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { type: "directory", path: safePath, items };
}
