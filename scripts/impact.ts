import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".next"]);

export type DependencyGraph = Map<string, Set<string>>;

function filesUnder(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) result.push(...filesUnder(path));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      result.push(path);
    }
  }
  return result;
}

function resolveImport(specifier: string, containingFile: string, options: ts.CompilerOptions): string | undefined {
  const resolved = ts.resolveModuleName(specifier, containingFile, options, ts.sys).resolvedModule;
  if (!resolved || resolved.isExternalLibraryImport) return undefined;
  const path = normalize(resolve(resolved.resolvedFileName));
  return SOURCE_EXTENSIONS.has(extname(path)) ? path : undefined;
}

function compilerOptionsFor(root: string): ts.CompilerOptions {
  const configPath = join(root, "tsconfig.json");
  if (!existsSync(configPath)) return { moduleResolution: ts.ModuleResolutionKind.NodeJs };
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  return { ...ts.convertCompilerOptionsFromJson(config.config.compilerOptions ?? {}, root).options };
}

export function buildDependencyGraph(repositoryRoot: string): DependencyGraph {
  const root = resolve(repositoryRoot);
  const files = [...filesUnder(join(root, "src")), ...filesUnder(join(root, "web", "src"))];
  const fileSet = new Set(files.map((file) => normalize(resolve(file))));
  const graph: DependencyGraph = new Map(files.map((file) => [normalize(resolve(file)), new Set()]));
  const optionsByRoot = new Map([
    [normalize(join(root, "src")), compilerOptionsFor(root)],
    [normalize(join(root, "web", "src")), compilerOptionsFor(join(root, "web"))],
  ]);

  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const options = file.startsWith(join(root, "web")) ? optionsByRoot.get(normalize(join(root, "web", "src")))! : optionsByRoot.get(normalize(join(root, "src")))!;
    const dependencies = graph.get(normalize(resolve(file)))!;
    source.forEachChild((node) => {
      const moduleSpecifier =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
      if (!moduleSpecifier) return;
      const dependency = resolveImport(moduleSpecifier, file, options);
      if (dependency && fileSet.has(dependency)) dependencies.add(dependency);
    });
  }
  return graph;
}

export function findDependents(graph: DependencyGraph, changedFiles: string[]): string[] {
  const changed = new Set(changedFiles.map((file) => normalize(resolve(file))));
  const dependents = new Set<string>();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [file, dependencies] of graph) {
      if (!dependents.has(file) && [...dependencies].some((dependency) => changed.has(dependency) || dependents.has(dependency))) {
        dependents.add(file);
        expanded = true;
      }
    }
  }
  return [...dependents].sort();
}

function changedFiles(root: string): string[] {
  const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  return [...new Set(`${tracked}\n${untracked}`.split("\n").filter(Boolean).map((file) => resolve(root, file)))];
}

function main(args: string[]): void {
  const root = process.cwd();
  const requested = args.includes("--changed") ? changedFiles(root) : args.filter((arg) => arg !== "--changed").map((file) => resolve(root, file));
  if (requested.length === 0) {
    console.error("Usage: bun run impact -- <file> [file ...] or bun run impact:changed");
    process.exitCode = 1;
    return;
  }
  const graph = buildDependencyGraph(root);
  const sourceFiles = requested.filter((file) => graph.has(normalize(file)));
  const dependents = findDependents(graph, sourceFiles);
  console.log("Changed files:");
  for (const file of requested) console.log(`  - ${relative(root, file)}`);
  console.log("\nTransitive dependents to review:");
  if (dependents.length === 0) console.log("  (none found in src/ or web/src/)");
  for (const file of dependents) console.log(`  - ${relative(root, file)}`);
}

if (require.main === module) main(process.argv.slice(2));
