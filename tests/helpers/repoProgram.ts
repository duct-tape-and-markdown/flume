/**
 * The base this suite's source scanners are visitors over: the tsconfig
 * parse, the repo-relative fold, the program and checker a scan resolves
 * through, the source selection both off the program and off disk, the token
 * walk, the directory walk, and the site and verdict vocabulary every scan
 * reports in.
 *
 * One job — *what the scanners share* — rather than a scanner of its own
 * (`.claude/rules/engineering.md`, *A module is one job*). Three siblings
 * each carried their own copy of the parse and the fold, spelled their site
 * and verdict three ways, and a fourth scanner would have copied all of it
 * again.
 *
 * What is deliberately **not** shared is the compiler-API tier each scanner
 * runs at, which is a choice each makes for a stated reason: the export scan
 * walks a declaration emit, the citation scan a checker-backed program, the
 * spawn scan a scopeless `createSourceFile`. This module carries the program
 * tier the checker-backed scans want and nothing above it; a scanner that
 * needs another builds it at its own site, where the reason is written down.
 *
 * Not *.test.ts, so neither vitest lane collects it as a suite of its own.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** Absolute path to this repo's root — the directory holding the manifest. */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Repo-relative, posix-separated — the alphabet every reported path uses. */
export const relPath = (root: string, path: string): string =>
  relative(root, path).split(/[\\/]/).join("/");

/**
 * A tsconfig parsed the way the toolchain parses it, refusing rather than
 * handing back a short file list: a scan over a config that half-parsed would
 * report every absence verdict green for having read nothing
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
export const parseConfig = (path: string): ts.ParsedCommandLine => {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(
        `${path}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
      );
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
  if (!parsed) {
    throw new Error(`no tsconfig at ${path}`);
  }
  return parsed;
};

/**
 * What a program-backed scan is given: the root it reads, and the config it
 * reads that root through. A scanner's own request extends this with
 * whatever else it consumes.
 */
export interface ProgramScanRequest {
  /** Absolute path to the scanned root — the directory holding the config. */
  readonly root: string;
  /**
   * The tsconfig describing the program. It is the widest config the repo
   * has: resolution reads the checker, and a tree left out of the program
   * resolves nothing.
   */
  readonly programConfig: string;
}

/** The program one scan judges through, with the checker that resolves it. */
export interface RepoProgram {
  /** The request's root, resolved absolute. */
  readonly root: string;
  /** The request's config, as it spelled it — what a refusal below names. */
  readonly configPath: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
}

/** The program a request describes, built once for a scan to walk. */
export const repoProgram = (request: ProgramScanRequest): RepoProgram => {
  const root = resolve(request.root);
  const parsed = parseConfig(resolve(root, request.programConfig));
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  return {
    root,
    configPath: request.programConfig,
    program,
    checker: program.getTypeChecker(),
  };
};

/**
 * The program's own sources: every non-declaration file, in path order,
 * narrowed to `trees` when a caller names any — repo-relative posix
 * prefixes, matched as prefixes.
 *
 * An empty selection refuses instead of returning: a scan whose domain
 * collapsed to nothing is the shape that reports a clean verdict over zero
 * subjects (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 */
export const sourcesOf = (
  repo: RepoProgram,
  trees?: readonly string[],
): readonly ts.SourceFile[] => {
  const inTrees = (path: string): boolean => {
    if (!trees) return true;
    const rel = relPath(repo.root, path);
    return trees.some((tree) => rel.startsWith(tree));
  };
  const sources = repo.program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && inTrees(resolve(sf.fileName)))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (sources.length === 0) {
    throw new Error(
      `no source of ${repo.configPath} sits under ${(trees ?? ["its own root"]).join(", ")}: the scan would judge nothing`,
    );
  }
  return sources;
};

/**
 * Every identifier and string literal under `node`, in source order — the
 * one walk both checker-backed scans read a file's tokens with. Each reads
 * the alphabet its verdict is in and passes over the other; neither resolves
 * on a substring, because a token is what the parser produced.
 */
export const eachToken = (
  node: ts.Node,
  visit: (token: ts.Identifier | ts.StringLiteralLike) => void,
): void => {
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) visit(n);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(node, walk);
};

/** One place a scan reports, in one module of the scanned root. */
export interface ScanSite {
  /** Module path, relative to the scan's root and in posix form. */
  readonly module: string;
  /** 1-based line the site sits on. */
  readonly line: number;
}

/**
 * What every scan returns: the set it judged, and the subset that failed the
 * judgment. `scanned` is what a vacuity pin reads — `n > 0` of the subject,
 * before any verdict is read off it — and `findings` is what a failure
 * message cites (`.claude/rules/engineering.md`, *A green verdict is proven
 * non-vacuous*).
 *
 * A second verdict over the *same* judged set is a second finding list beside
 * `findings`. A second verdict over a *different* judged set is a second
 * `Scan`, on these same two names, so a vacuity pin reads one vocabulary
 * whichever verdict it is guarding.
 */
export interface Scan<Site extends ScanSite, Finding = Site> {
  readonly scanned: readonly Site[];
  readonly findings: readonly Finding[];
}

/** Which files a directory walk collects, and which it drops again. */
export interface FileWalk {
  /** The directory the walk descends, absolute. */
  readonly root: string;
  /** The suffix a file carries to be collected, e.g. `.test.ts`. */
  readonly suffix: string;
  /** The suffixes that take it back out, e.g. `.integration.test.ts`. */
  readonly excluded?: readonly string[];
}

/**
 * Every file under a walk's root, at any depth, carrying its suffix and none
 * of its exclusions — absolute paths, in the order the directories yield
 * them. Off disk rather than from a list: a file added in a new
 * subdirectory is exactly what these scans exist to see, and a hand-kept
 * list is what would not carry it.
 *
 * `dir` is the subtree descended and defaults to the walk's own root. It is
 * a parameter so a scan's own test can drive it over a fixture whose files
 * are written to be caught; the walk's suffixes apply either way.
 */
export const filesUnder = (
  walk: FileWalk,
  dir: string = walk.root,
): string[] => {
  const out: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...filesUnder(walk, path));
    else if (
      dirent.name.endsWith(walk.suffix) &&
      !(walk.excluded ?? []).some((dropped) => dirent.name.endsWith(dropped))
    )
      out.push(path);
  }
  return out;
};

/**
 * The extensions a module of this repo is written in. Wider than the program
 * tier reads, because a domain walked off disk reaches the trees no tsconfig
 * includes — `bin/*.js`, `scripts/*.mjs` — and a scan narrowed to `.ts` would
 * report those trees as holding nothing.
 */
const SOURCE_SUFFIXES: readonly string[] = [
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
];

/** Emitted types declare nothing a source scan reads. */
const EXCLUDED_SUFFIXES: readonly string[] = [".d.ts"];

/**
 * What a scan reads when it is not drawn from a program: trees walked whole,
 * and files named one by one for a directory whose other contents are not
 * source of this repo's.
 *
 * `files` is omitted by a caller whose domain is trees alone. A named file is
 * how a directory is reached without descending it — `.flume/` also holds the
 * worktree checkouts a tick runs in (`spec/worktrees.md`), whole copies of
 * this repo a tree walk would judge again.
 */
export interface ScanDomain {
  /** Repo-relative posix prefixes, each walked to any depth. */
  readonly trees: readonly string[];
  /** Repo-relative posix paths, each read on its own. */
  readonly files?: readonly string[];
}

/**
 * Every module a domain resolves to, absolute and in a stable order.
 *
 * Both halves refuse rather than shrink: a tree holding no source module and
 * a named file the tree no longer has are each an error here, because a
 * domain that quietly collapsed would report every absence verdict green for
 * having read nothing (`.claude/rules/engineering.md`, *A green verdict is
 * proven non-vacuous*).
 */
export const modulesUnder = (
  root: string,
  domain: ScanDomain,
): readonly string[] => {
  const found = new Set<string>();
  for (const tree of domain.trees) {
    const dir = join(root, ...tree.split("/"));
    // Absent and empty are one verdict, and it is the scan's own: an ENOENT
    // out of the walk names a directory rather than the domain entry that
    // asked for it, which is the fact a reader of the failure needs.
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory())
      throw new Error(
        `no source module under ${tree}: the scan would judge that tree as holding none`,
      );
    const before = found.size;
    for (const suffix of SOURCE_SUFFIXES)
      for (const path of filesUnder({
        root: dir,
        suffix,
        excluded: EXCLUDED_SUFFIXES,
      }))
        found.add(path);
    if (found.size === before)
      throw new Error(
        `no source module under ${tree}: the scan would judge that tree as holding none`,
      );
  }
  for (const file of domain.files ?? []) {
    const path = join(root, ...file.split("/"));
    if (!statSync(path, { throwIfNoEntry: false })?.isFile())
      throw new Error(
        `no source module at ${file}: the scan would judge that file as holding none`,
      );
    found.add(path);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
};
