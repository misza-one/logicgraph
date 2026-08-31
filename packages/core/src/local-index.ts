import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadLogicGraphConfigWithSource } from "./config/load.js";
import { buildRelationshipGraph, type RelationshipGraph } from "./graph/impact.js";
import { validateRules, type RuleValidationResult } from "./rules/validate.js";
import { loadUIContracts, type UIContractLoadResult } from "./ui-contracts/load.js";
import { pathExists, relativePath } from "./yaml.js";

export const logicGraphDatabaseName = "logicgraph.db";
const indexSchemaVersion = "2";
const indexGitignorePatterns = ["logicgraph.db", "logicgraph.db-shm", "logicgraph.db-wal"];
const indexGitignoreBlock = `# LogicGraph local index/cache, not for committing.\n${indexGitignorePatterns.join("\n")}\n`;

export interface LogicGraphIndexStatus {
  cwd: string;
  dbPath: string;
  configExists: boolean;
  initialized: boolean;
  upToDate: boolean;
  nodeCount: number;
  edgeCount: number;
  sourceCount: number;
  ruleCount: number;
  uiContractCount: number;
  fieldCount: number;
  indexedAt?: string;
  error?: string;
}

interface SourceFile {
  kind: "config" | "rule" | "ui-contract";
  path: string;
  source: string;
  id?: string;
  valid: boolean;
  errorCount: number;
}

interface Snapshot {
  graph: RelationshipGraph;
  sources: SourceFile[];
  fingerprint: string;
  ruleCount: number;
  uiContractCount: number;
  fieldCount: number;
}

interface StoredIndexStatus extends LogicGraphIndexStatus {
  schemaVersion?: string;
  sourceFingerprint?: string;
}

export async function rebuildProjectIndex(options: { cwd?: string } = {}): Promise<LogicGraphIndexStatus> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const dbPath = indexPath(cwd);
  const root = join(cwd, ".logicgraph");
  const rootError = await unsafeIndexRootError(cwd, root);
  if (rootError) {
    throw new Error(rootError);
  }
  const snapshot = await readSnapshot(cwd);
  await mkdir(root, { recursive: true });
  await ensureIndexGitignore(root);
  await unlinkIndexFiles(dbPath);

  const db = openDatabase(dbPath);
  try {
    writeIndex(db, snapshot);
  } finally {
    db.close();
  }

  return statusFromSnapshot(cwd, dbPath, snapshot, true, await fileIndexedAt(dbPath));
}

export async function getProjectIndexStatus(options: { cwd?: string } = {}): Promise<LogicGraphIndexStatus> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const dbPath = indexPath(cwd);
  const root = join(cwd, ".logicgraph");
  const rootError = await unsafeIndexRootError(cwd, root);
  if (rootError) {
    return { ...emptyStatus(cwd, dbPath, false, rootError), initialized: true };
  }
  const configExists = await pathExists(join(cwd, ".logicgraph", "config.yaml"));
  if (!(await pathExists(dbPath))) {
    return emptyStatus(cwd, dbPath, configExists, "index missing");
  }

  const indexFileError = await unsafeIndexFileError(cwd, dbPath);
  if (indexFileError) {
    return { ...emptyStatus(cwd, dbPath, configExists, indexFileError), initialized: true };
  }

  const stored = readStoredStatus(cwd, dbPath, configExists);
  if (stored.error) {
    return stored;
  }

  try {
    const snapshot = await readSnapshot(cwd);
    return { ...stored, upToDate: stored.schemaVersion === indexSchemaVersion && stored.sourceFingerprint === snapshot.fingerprint };
  } catch (error) {
    return { ...stored, upToDate: false, error: errorMessage(error) };
  }
}

function writeIndex(db: DatabaseSync, snapshot: Snapshot): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("BEGIN");
  try {
    db.exec(`
      DROP TABLE IF EXISTS meta;
      DROP TABLE IF EXISTS nodes;
      DROP TABLE IF EXISTS edges;
      DROP TABLE IF EXISTS sources;

      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, title TEXT, search TEXT);
      CREATE TABLE edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (from_id, to_id, kind));
      CREATE TABLE sources (path TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT, valid INTEGER NOT NULL, error_count INTEGER NOT NULL);
    `);

    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insertMeta.run("schemaVersion", indexSchemaVersion);
    insertMeta.run("sourceFingerprint", snapshot.fingerprint);
    insertMeta.run("indexedAt", new Date().toISOString());
    insertMeta.run("nodeCount", String(snapshot.graph.nodes.length));
    insertMeta.run("edgeCount", String(snapshot.graph.edges.length));
    insertMeta.run("sourceCount", String(snapshot.sources.length));
    insertMeta.run("ruleCount", String(snapshot.ruleCount));
    insertMeta.run("uiContractCount", String(snapshot.uiContractCount));
    insertMeta.run("fieldCount", String(snapshot.fieldCount));

    const insertNode = db.prepare("INSERT INTO nodes (id, kind, label, title, search) VALUES (?, ?, ?, ?, ?)");
    for (const node of [...snapshot.graph.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      insertNode.run(node.id, node.kind, node.label, node.title ?? null, node.search ? JSON.stringify(node.search) : null);
    }

    const insertEdge = db.prepare("INSERT INTO edges (from_id, to_id, kind) VALUES (?, ?, ?)");
    for (const edge of [...snapshot.graph.edges].sort((a, b) => `${a.from}\0${a.to}\0${a.kind}`.localeCompare(`${b.from}\0${b.to}\0${b.kind}`))) {
      insertEdge.run(edge.from, edge.to, edge.kind);
    }

    const insertSource = db.prepare("INSERT INTO sources (path, kind, id, valid, error_count) VALUES (?, ?, ?, ?, ?)");
    for (const source of [...snapshot.sources].sort((a, b) => a.path.localeCompare(b.path))) {
      insertSource.run(source.path, source.kind, source.id ?? null, source.valid ? 1 : 0, source.errorCount);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function readSnapshot(cwd: string): Promise<Snapshot> {
  const { config, source: configSource } = await loadLogicGraphConfigWithSource(cwd);
  const [rules, uiContracts] = await Promise.all([
    validateRules({ cwd, rulesDir: resolve(cwd, ".logicgraph", config.rules) }),
    loadUIContracts({ cwd, uiContractsDir: resolve(cwd, ".logicgraph", config.uiContracts) }),
  ]);
  if (!rules.ok) {
    const first = rules.files.find((file) => file.errors[0]);
    throw new Error(first ? `${first.relativePath}: ${first.errors[0]?.message}` : (rules.directoryError ?? "Cannot build index until rules validate."));
  }
  if (!uiContracts.ok) {
    const first = uiContracts.files.find((file) => file.errors[0]);
    throw new Error(first ? `${first.relativePath}: ${first.errors[0]?.message}` : (uiContracts.directoryError ?? "Cannot build index until UI contracts validate."));
  }

  const graph = buildRelationshipGraph(rules.rules, uiContracts.contracts);
  const sources = sourceFiles(cwd, configSource, rules, uiContracts);
  return {
    graph,
    sources,
    fingerprint: fingerprint(sources),
    ruleCount: rules.rules.length,
    uiContractCount: uiContracts.contracts.length,
    fieldCount: graph.nodes.filter((node) => node.kind === "field").length,
  };
}

function readStoredStatus(cwd: string, dbPath: string, configExists: boolean): StoredIndexStatus {
  const db = openDatabase(dbPath);
  try {
    return {
      cwd,
      dbPath,
      configExists,
      initialized: true,
      upToDate: false,
      nodeCount: metaNumber(db, "nodeCount") ?? count(db, "nodes"),
      edgeCount: metaNumber(db, "edgeCount") ?? count(db, "edges"),
      sourceCount: metaNumber(db, "sourceCount") ?? count(db, "sources"),
      ruleCount: metaNumber(db, "ruleCount") ?? countWhere(db, "nodes", "kind = 'rule'"),
      uiContractCount: metaNumber(db, "uiContractCount") ?? countWhere(db, "nodes", "kind = 'ui-contract'"),
      fieldCount: metaNumber(db, "fieldCount") ?? countWhere(db, "nodes", "kind = 'field'"),
      schemaVersion: meta(db, "schemaVersion"),
      sourceFingerprint: meta(db, "sourceFingerprint"),
      indexedAt: meta(db, "indexedAt"),
    };
  } catch (error) {
    return { ...emptyStatus(cwd, dbPath, configExists, errorMessage(error)), initialized: true };
  } finally {
    db.close();
  }
}

function statusFromSnapshot(cwd: string, dbPath: string, snapshot: Snapshot, upToDate: boolean, indexedAt?: string): LogicGraphIndexStatus {
  return {
    cwd,
    dbPath,
    configExists: true,
    initialized: true,
    upToDate,
    nodeCount: snapshot.graph.nodes.length,
    edgeCount: snapshot.graph.edges.length,
    sourceCount: snapshot.sources.length,
    ruleCount: snapshot.ruleCount,
    uiContractCount: snapshot.uiContractCount,
    fieldCount: snapshot.fieldCount,
    indexedAt,
  };
}

function emptyStatus(cwd: string, dbPath: string, configExists: boolean, error?: string): LogicGraphIndexStatus {
  return {
    cwd,
    dbPath,
    configExists,
    initialized: false,
    upToDate: false,
    nodeCount: 0,
    edgeCount: 0,
    sourceCount: 0,
    ruleCount: 0,
    uiContractCount: 0,
    fieldCount: 0,
    error,
  };
}

function sourceFiles(cwd: string, configSource: string, rules: RuleValidationResult, uiContracts: UIContractLoadResult): SourceFile[] {
  return [
    { kind: "config" as const, path: ".logicgraph/config.yaml", source: configSource, id: "config", valid: true, errorCount: 0 },
    ...rules.files.map((file) => ({
      kind: "rule" as const,
      path: file.relativePath,
      source: file.source!,
      id: file.id,
      valid: file.valid,
      errorCount: file.errors.length,
    })),
    ...uiContracts.files.map((file) => ({
      kind: "ui-contract" as const,
      path: file.relativePath,
      source: file.source!,
      id: file.id,
      valid: file.valid,
      errorCount: file.errors.length,
    })),
  ].map((source) => ({ ...source, path: relativePath(cwd, resolve(cwd, source.path)) }));
}

function fingerprint(sources: SourceFile[]): string {
  const hash = createHash("sha256");
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(source.path);
    hash.update("\0");
    hash.update(source.source);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function count(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function countWhere(db: DatabaseSync, table: string, where: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count);
}

function meta(db: DatabaseSync, key: string): string | undefined {
  return (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined)?.value;
}

function metaNumber(db: DatabaseSync, key: string): number | undefined {
  const value = meta(db, key);
  return value === undefined ? undefined : Number(value);
}

async function fileIndexedAt(dbPath: string): Promise<string | undefined> {
  return (await stat(dbPath)).mtime.toISOString();
}

function indexPath(cwd: string): string {
  return join(cwd, ".logicgraph", logicGraphDatabaseName);
}

async function ensureIndexGitignore(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  await unlinkIfSymlink(path);
  const stats = await lstatIfExists(path);
  if (stats && !stats.isFile()) {
    throw new Error(`${relativePath(root, path)} must be a regular file`);
  }
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    await writeFile(path, indexGitignoreBlock, "utf8");
    return;
  }
  if (hasIndexGitignorePatterns(existing)) {
    return;
  }
  await unlinkIfExists(path);
  await writeFile(path, `${existing}${existing.endsWith("\n") ? "" : "\n"}\n${indexGitignoreBlock}`, "utf8");
}

function hasIndexGitignorePatterns(existing: string): boolean {
  return indexGitignorePatterns.every((path) => isIgnored(existing, path));
}

function isIgnored(existing: string, path: string): boolean {
  let ignored = false;
  for (const rawLine of existing.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const negated = line.startsWith("!");
    const pattern = line.slice(negated ? 1 : 0).replace(/^\//, "");
    if (!negated && pattern === path) {
      ignored = true;
    } else if (negated && couldMatchCacheFile(pattern, path)) {
      ignored = false;
    }
  }
  return ignored;
}

function couldMatchCacheFile(pattern: string, path: string): boolean {
  return pattern === path || pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

async function unlinkIndexFiles(dbPath: string): Promise<void> {
  for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    await unlinkIfExists(path);
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
}

async function unlinkIfSymlink(path: string): Promise<void> {
  const stats = await lstatIfExists(path);
  if (stats?.isSymbolicLink()) {
    await unlink(path);
  }
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function unsafeIndexRootError(cwd: string, root: string): Promise<string | undefined> {
  const stats = await lstatIfExists(root);
  if (stats && (stats.isSymbolicLink() || !stats.isDirectory())) {
    return `${relativePath(cwd, root)} must be a regular local directory`;
  }
  return undefined;
}

async function unsafeIndexFileError(cwd: string, dbPath: string): Promise<string | undefined> {
  for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink() || stats.nlink > 1) {
        return `${relativePath(cwd, path)} must be a regular local cache file`;
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }
  return undefined;
}

function openDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
