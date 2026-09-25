/**
 * `flume-harness init` — what adopting the harness package writes into a
 * repository (`spec/harness.md`, *Adoption and upgrade*): the declaration
 * skeleton, the `chain.ts` that applies the package's factory to it, the
 * manifest that scopes both as ESM, the state root with an empty queue in
 * it, the ignore set, a protocol page, and
 * the dependency line that makes `@dtmd/flume/harness` resolve from the
 * declaration that imports it. The engine refuses a load with no
 * `<configDir>/chain.ts`, so an adoption that stopped at the declaration
 * would leave a repository one hand-written file short of its first tick.
 *
 * **A verb on the harness bin, never on the engine's.** The engine's verb set
 * is closed and `src/` never imports this directory, so an adoption verb on
 * `flume` would be the engine reaching up into flume's opinion about how to
 * run it. The package ships its own bin instead (`spec/cli.md`,
 * *Distribution*), and this module is what that bin's `init` runs.
 *
 * **Every refusal is taken before the first byte is written.** An init that
 * stopped half-way would leave a repository carrying an ignore set for a
 * state root that does not exist, or a protocol page beside no declaration —
 * a tree nothing refuses and no re-run can distinguish from a finished one.
 * Every input the adoption reads — the state root's absence, this package's
 * own manifest, the consumer's — is resolved before the first `mkdir`, and
 * nothing on disk is touched until all of them pass
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * **What init writes once, it never rewrites.** Everything here is the
 * consumer's from the moment it lands: an upgrade is a version bump and a
 * migration note, never a re-run that reconciles a declaration a consumer
 * has since edited. That is why the refusal below is a refusal rather than a
 * merge.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { existsLoud } from "../src/fsProbe.js";
import {
  namespacedJoin,
  resolvePendingDir,
  STATE_ROOT_DIRNAME,
} from "../src/paths.js";
import { mergeIgnoreLines } from "../src/runtimeIgnores.js";
import { readSelfPackage } from "../src/selfPackage.js";

import { detailOf } from "./exec.js";
import { resolvesInTree, tipOf } from "./gitRange.js";
import { consumerIgnores } from "./ignores.js";
import { planStatePath, PROTOCOL_REL, queueDir } from "./layout.js";
import { seedPlanState } from "./planState.js";

/** The directory holding this module, in whichever layout it is running from. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The state root a consumer gets unless it says otherwise — the bay name the
 * engine resolves from a repository root when nothing overrides it
 * (`spec/cli.md`, *Bay discovery walks up to the nearest `.flume`*). Taken
 * from the engine rather than restated: init's default and the dir the
 * engine's own discovery walk looks for are one fact, and a second spelling
 * here would write an adoption the engine then fails to find
 * (`.claude/rules/engineering.md`, *Derived state is computed, never
 * restated beside its source*).
 *
 * Spelled as a default rather than baked in: everything this module composes
 * takes the root as a parameter, so a consumer adopting into a different one
 * gets a declaration, an ignore set, and a protocol page that agree about
 * where its state lives.
 */
export const DEFAULT_STATE_ROOT = STATE_ROOT_DIRNAME;

/** Where the declaration sits under a state root (`spec/harness.md`). */
const DECLARATION_REL = "declaration.ts";

/**
 * Where the chain the engine loads sits — `<configDir>/chain.ts` and nowhere
 * else (`spec/chain.md`, *Chain residency — one chain per `.flume`*), which
 * for a consumer adopting the package is the state root init just made.
 */
const CHAIN_REL = "chain.ts";

/**
 * The manifest that sits beside {@link CHAIN_REL} — the one file deciding
 * which module system the chain and the declaration load in.
 */
const MANIFEST_REL = "package.json";

/**
 * All it declares, and all it may declare: `"type": "module"`.
 *
 * The loader reads `chain.ts` in the mode the **nearest** manifest names, and
 * the package is ESM-only (`spec/chain.md`). With nothing in scope saying
 * otherwise that mode is CommonJS, and the ESM-only package the chain imports
 * stops resolving — on every node 22 for the chain written here, and from
 * node 22.23 for a hand-written one (`.claude/rules/platform-facts.md`, *A
 * CommonJS-scoped `chain.ts` stops loading the ESM-only package at node
 * 22.23*). Node 24 resolves both and hides it, which is why no lane saw this
 * before a consumer did.
 *
 * Beside the chain rather than in the consumer's own manifest, and carrying
 * nothing else: which module system a *repository* is written in is the
 * consumer's decision, and this touches none of it. A CommonJS repository
 * adopts the package and its chain still loads.
 */
const STATE_ROOT_MANIFEST = `${JSON.stringify({ type: "module" }, null, 2)}\n`;

/**
 * The file a repository's empty queue directory starts life with, so that
 * directory is in the tree from the first commit and stays there once every
 * entry has shipped.
 *
 * Not an entry, by its name: the engine reads only `*.json` directly under
 * the directory (`spec/pending.md`, *The ledger is a directory — one entry
 * per file*), and the fence glob a plan slice is held to admits only those
 * too, so nothing in the package can write or drain this file after the
 * seed. `.gitkeep` is git's own idiom for the job and no engine surface
 * spells it, which is why it is spelled here.
 */
const QUEUE_KEEP = ".gitkeep";

/**
 * The placeholder the shipped `harness/templates/PROTOCOL.md` carries
 * wherever it names the consumer's state root. One token, substituted by
 * value: a template that spelled `.flume` would be silently wrong for every
 * consumer that adopted into another root.
 */
const STATE_ROOT_TOKEN = "{{STATE_ROOT}}";

export interface HarnessInitOptions {
  /** The repository being adopted into. Every path below is relative to it. */
  readonly repoRoot: string;
  /**
   * Where the consumer's flume state lives, relative to `repoRoot`. Defaults
   * to {@link DEFAULT_STATE_ROOT}.
   */
  readonly stateRoot?: string;
}

/**
 * What became of the dependency clause of adoption — a **fact, never a
 * verdict**: init states what it found and what it wrote, and whether to run
 * an install (and with which package manager) stays the operator's.
 */
export type DependencyOutcome =
  /** The manifest did not declare the package; init added it. */
  | { readonly kind: "added"; readonly manifest: string; readonly range: string }
  /**
   * The manifest already declared the package. Left exactly as it was: a
   * consumer pinning a range is a decision, and overwriting it would be init
   * choosing a version on their behalf.
   */
  | {
      readonly kind: "declared";
      readonly manifest: string;
      readonly range: string;
    }
  /**
   * The repository has no `package.json`, so there is nothing to add the
   * dependency to and init writes no manifest of its own — which package
   * manager, which fields, and whether this repository is a package at all
   * are the consumer's to decide.
   *
   * Degraded but proceeding, and bounded by a refusal downstream: the
   * declaration init just wrote imports `<name>/harness`, so the first tick
   * run without the package installed fails at module resolution naming the
   * specifier, rather than running on a default nobody chose
   * (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  | { readonly kind: "absent"; readonly range: string };

/**
 * What became of the plan-state clause of adoption — again a **fact, never a
 * verdict**: init says which tip it stamped the cursors at, or that the
 * repository named none, and what an unseeded state root then means for the
 * first tick is the consumer's to read.
 *
 * The seed is what keeps a fresh adopter's first plan wave about the
 * repository's present: with no cursor on disk, derive opens over the whole
 * of the declared spec locus and the sweep goes live over the whole declared
 * domain, all of it written before the repository adopted the package
 * (`cursorWindow.ts`).
 */
export type PlanStateOutcome =
  /** Every cursor-carrying slice's state written, stamped at this tip. */
  | { readonly kind: "seeded"; readonly tip: string }
  /**
   * The repository named no commit for a cursor to stand at, so init wrote
   * no plan state at all.
   *
   * Not a refusal: adopting before the first commit is a real thing to do —
   * the install smoke does exactly that — and a repository is not obliged to
   * be a git checkout at the moment it is adopted into. A cursor is a sha,
   * there is no sha, and a seed here would have to invent one. Degraded but
   * proceeding, and bounded by what it leaves behind: no state file, which
   * is the state every window already reads as "nothing derived yet" and
   * opens in full over (`.claude/rules/engineering.md`, *Loud or nothing*).
   */
  | { readonly kind: "no-commit" };

export interface HarnessInitResult {
  /** The repository adopted into, absolute. */
  readonly repoRoot: string;
  /** The state root, relative to `repoRoot` and slash-joined. */
  readonly stateRoot: string;
  /**
   * The files init created, relative to `repoRoot` and slash-joined, in the
   * order it wrote them.
   */
  readonly written: readonly string[];
  /**
   * The ignore lines init appended to the repository's `.gitignore`. Empty
   * when the file already carried every one of them.
   */
  readonly ignoreLines: readonly string[];
  /** The package specifier a consumer's declaration imports. */
  readonly packageName: string;
  /** What became of the dependency clause. */
  readonly dependency: DependencyOutcome;
  /** What became of the plan-state clause. */
  readonly planState: PlanStateOutcome;
}

/**
 * Where the shipped `harness/templates/PROTOCOL.md` lives on disk —
 * absolute, resolved from this module rather than from any caller's cwd, for
 * the reason `promptPath` (`prompts.ts`) is: it is package content, and the
 * same relative hop has to reach it from a checkout's `harness/` and from the
 * emit's `dist/harness/` alike. `tsc` emits no markdown, so the build's
 * asset-copy step is what puts it there (`scripts/pack-harness-assets.mjs`).
 */
export function protocolTemplatePath(): string {
  return fileURLToPath(new URL(`templates/${PROTOCOL_REL}`, import.meta.url));
}

/**
 * The declaration a consumer starts from — every required field of
 * `DeclarationSchema` present and parseable, every value obviously theirs to
 * change.
 *
 * A module rather than JSON because `runner` is a factory with behavior
 * (`spec/harness.md`, *What a consumer declares*), and named beside its
 * default export so a consumer's `chain.ts` never has to unwrap it: what
 * `tsImport` hands back for a default-only `.ts` module is not that module's
 * to decide (`.claude/rules/platform-facts.md`, *tsx decides a module's
 * interop shape from the nearest `package.json` `type`*).
 *
 * It annotates itself with `DeclarationInput`, so the shape the schema
 * refuses at load is the shape a consumer's editor completes and their
 * typecheck refuses first. `satisfies` rather than a declared type: the
 * literal keeps its own narrow type for anything else in the module that
 * reads it, and excess fields are still caught.
 *
 * What it does **not** carry: a plan slice enabled without the inputs that
 * slice needs, a gate, an agent model, or a supervisor knob. Each is the
 * package's opinion until a consumer states otherwise, and a skeleton that
 * pre-stated them would ship taste the consumer has to discover to turn off
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 */
function declarationSkeleton(packageName: string): string {
  return `/**
 * This repository's flume harness declaration — the one file that decides
 * this environment (\`${packageName}\`, spec/harness.md, *What a consumer
 * declares*). Written by \`flume-harness init\`; yours from here.
 *
 * The package's schema validates this at chain load: an unknown field, or a
 * required one missing, refuses the load naming the field rather than
 * falling through to a default nobody chose. The \`satisfies\` clause below
 * is that same shape a rung earlier — your editor completes the fields, and
 * \`tsc\` refuses a typo before a tick ever runs.
 */

import { vitestRunner, type DeclarationInput } from "${packageName}/harness";

export const declaration = {
  /**
   * Where a \`per\` cite may point, as path globs. The \`per\` gate refuses a
   * plan commit whose cite resolves nowhere here.
   */
  specLocus: ["spec/**"],

  /**
   * What each phase may write. \`build\` is required; a plan slice listed
   * here may write those paths beyond the package's own plan artifacts.
   */
  fence: {
    build: ["src/**", "tests/**"],
  },

  /**
   * The test runner the judge drives, as a factory the chain calls at load
   * with \`{ api, provision }\` — the engine's own API for the base
   * checkout's worktree base, and a declared \`setup\` reduced to the
   * function that provisions it, or the engine's installer at the root when
   * none is declared. The package ships vitest's; a project
   * running cargo, dotnet or a script declares its own factory over the same
   * three operations (spec/harness.md, *The runner interface*).
   */
  runner: vitestRunner(),

  /**
   * Which plan slices run. Adding "plan-sweep" requires a \`sweep\` block
   * naming the domain it draws a frontier over and the posture pages whose
   * sections it applies.
   */
  slices: {
    enabled: ["plan-inbox", "plan-derive"],
  },
} satisfies DeclarationInput;

export default declaration;
`;
}

/**
 * The hop the engine's loader lands on: `<configDir>/chain.ts`, applying the
 * package's factory to the declaration beside it.
 *
 * Written rather than left to the consumer because it is the same three
 * lines in every repository that adopts the package — a block that appears
 * unchanged in every consumer's chain is a missing surface, not a chain
 * concern (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 * Everything a consumer decides lives one file over, in the declaration this
 * module just wrote; nothing here is theirs to tune, and a behavior edited
 * in belongs in the package, where every consumer gets it.
 *
 * The declaration rides in unparsed: the schema's refusal is a fact of chain
 * load rather than of a consumer remembering to call `parseDeclaration`
 * (`chain.ts`, *The declaration is parsed here*).
 *
 * `ChainFactory` comes from the package root and `harnessChain` from its
 * `/harness` subpath — the two halves of the `exports` map, and the reason
 * the type import is spelled `import type`: the root specifier is erased
 * before the loader ever resolves it, so the engine value a chain never
 * imports stays un-imported (`src/flumeApi.ts`).
 */
function chainSkeleton(packageName: string): string {
  return `/**
 * This repository's chain — the harness package's factory applied to the
 * declaration beside it, and nothing else (\`${packageName}\`,
 * spec/harness.md, *Adoption and upgrade*). The engine loads this file and
 * refuses a tick without it; every slice, prompt, judge and gate it then
 * runs comes from the package.
 *
 * Written by \`flume-harness init\`, and the same hop in every repository
 * that adopts the package. What this environment decides it declares in
 * \`./declaration.ts\` — a behavior edited in here is one no version bump
 * carries forward.
 */

import type { ChainFactory } from "${packageName}";
import { harnessChain } from "${packageName}/harness";

// The \`.js\` names the \`declaration.ts\` beside this file: a TypeScript
// import carries the extension the emit would have, which every
// \`moduleResolution\` mode — and the loader that runs this file — resolves
// back to the source.
import { declaration } from "./declaration.js";

const factory: ChainFactory = (api) => ({
  chain: harnessChain({ api, declaration }),
});

export default factory;
`;
}

/**
 * The tip a cursor seeded by this adoption would stand at, or `undefined`
 * where the repository names none.
 *
 * Both ways it names none are one answer, and that is declared here rather
 * than folded into the predicate: a checkout with no commit yet has a `HEAD`
 * that resolves to nothing, and a directory that is not a checkout at all
 * fails the read outright — neither is a reason to refuse an adoption
 * ({@link PlanStateOutcome}, `no-commit`). The degradation is bounded by what
 * it leaves behind: no plan state, which every window already reads as
 * "nothing derived yet" and opens in full over
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * The catch is this site's because the tolerance is. `resolvesInTree` answers
 * whether a revision names a commit and throws on a tree it could not read,
 * so a plan window over such a tree refuses as unreadable instead of sending
 * a tick to repair a cursor that was correct (`gitRange.ts`); an adoption is
 * the one caller that wants both outcomes spelled the same way.
 */
function tipIfAny(repoRoot: string): string | undefined {
  try {
    return resolvesInTree(repoRoot, "HEAD") ? tipOf(repoRoot) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adopt the harness package into `repoRoot`.
 *
 * Refuses rather than overwrites when the state root is already there: a
 * repository that has one has a declaration a consumer has edited, and the
 * question "is this adoption or an upgrade?" has one safe answer
 * (`spec/harness.md`, *Adoption and upgrade* — upgrading is a version bump
 * and a migration note, never a re-run).
 */
export async function harnessInit(
  options: HarnessInitOptions,
): Promise<HarnessInitResult> {
  const repoRoot = resolve(options.repoRoot);
  const stateRoot = options.stateRoot ?? DEFAULT_STATE_ROOT;
  const stateRootAbs = join(repoRoot, stateRoot);

  // Before anything on disk moves: `existsLoud` refuses on a stat failure
  // that is not absence, so a state root that is present but unreachable
  // never reads as "not adopted yet" and gets written over.
  // win32 MAX_PATH (`.claude/rules/platform-facts.md`): every path below is
  // handed to an fs call through `namespacedJoin`, the shared idiom, since a
  // consumer's repository root is a path this package did not choose. The
  // plain spelling is what gets reported and thrown.
  if (existsLoud(namespacedJoin(stateRootAbs))) {
    throw new Error(
      `flume-harness init: ${stateRootAbs} already exists — refusing to ` +
        `overwrite it. A repository with a state root has already adopted ` +
        `the package; upgrading is a version bump plus the release's ` +
        `migration note, not a re-run of init. Remove the directory to ` +
        `start over.`,
    );
  }

  // Read before writing, for the same reason: an input this adoption cannot
  // resolve — a package whose own manifest has no version to write into the
  // consumer's dependency line, a template still carrying a placeholder, a
  // consumer manifest that is not JSON — should leave the repository
  // untouched rather than refuse over a half-written tree.
  const self = readSelfPackage(HERE);
  const template = await readFile(namespacedJoin(protocolTemplatePath()), "utf8");
  const protocol = renderProtocol(template, stateRoot);
  const manifest = await readConsumerManifest(repoRoot);

  // The tip the cursors this adoption seeds will stand at — resolved here,
  // in the preflight, rather than at the write, so the sha stamped is one
  // this adoption read before it touched the tree.
  const tip = tipIfAny(repoRoot);

  await mkdir(namespacedJoin(stateRootAbs), { recursive: true });
  const written: string[] = [];
  for (const [rel, body] of [
    // The manifest first: it is the scope the two modules under it load in,
    // and a consumer reading the report sees what put them in it.
    [MANIFEST_REL, STATE_ROOT_MANIFEST],
    [DECLARATION_REL, declarationSkeleton(self.name)],
    [CHAIN_REL, chainSkeleton(self.name)],
    [PROTOCOL_REL, protocol],
  ] as const) {
    await writeFile(namespacedJoin(stateRootAbs, rel), body, "utf8");
    written.push(`${stateRoot}/${rel}`);
  }

  // The queue directory, which nothing else creates — and the placeholder
  // that keeps it in a tree.
  //
  // A plan slice reads the queue with a bare reader, and the pending gate
  // fails an *absent* queue directory (`spec/pending.md`, *`pendingGate` —
  // validation and fence pre-check as an opt-in builtin*). Git holds no empty
  // directory, so without a file of its own the directory would vanish from
  // the tree the moment the last entry shipped, and the next plan commit
  // would revert on a queue that was simply drained. The placeholder is that
  // file: no `*.json`, so the engine never reads it as work (*The ledger is a
  // directory — one entry per file*: the listing is the queue), and no fence
  // glob admits it, so no slice can write or drain it either.
  //
  // Addressed through the engine's own resolver rather than spelled here: the
  // dispatcher, `flume check` and `flume status` all reach the queue through
  // it, and a second spelling would seed a directory none of them read
  // (`.claude/rules/engineering.md`, *Derived state is computed, never
  // restated beside its source*). That resolver answers host-native, which is
  // what the fs calls want; the line this reports is a repo path, so it comes
  // from the layout that states the queue's git spelling for every consumer
  // of it (`queueDir`, `harness/layout.ts`).
  const pendingAbs = resolvePendingDir(stateRootAbs);
  await mkdir(namespacedJoin(pendingAbs), { recursive: true });
  await writeFile(namespacedJoin(pendingAbs, QUEUE_KEEP), "", "utf8");
  written.push(`${queueDir(stateRoot)}/${QUEUE_KEEP}`);

  // The plan state, stamped at the tip above: each cursor-carrying slice
  // starts life having derived and swept everything up to the moment this
  // repository adopted the package, so its first plan wave is about what
  // lands after it rather than about the whole history that came before.
  //
  // Which slices those are, and what each one's starting state says, is
  // `planState.ts`'s — the module that owns the artifacts. This one reports
  // the paths, in git's alphabet, off the same layout the fence and the
  // accessor read them from.
  if (tip !== undefined) {
    for (const slice of seedPlanState(stateRootAbs, tip)) {
      written.push(planStatePath(stateRoot, slice));
    }
  }

  // Derived from the engine's own path record, never hand-listed
  // (`ignores.ts`), and merged rather than replacing: a repository's
  // `.gitignore` is the consumer's file and everything already in it stays.
  const ignoreLines = await mergeIgnoreLines(
    namespacedJoin(repoRoot, ".gitignore"),
    consumerIgnores(stateRoot),
  );

  return {
    repoRoot,
    stateRoot,
    written,
    ignoreLines,
    packageName: self.name,
    dependency: await addDependency(manifest, self.name, `^${self.version}`),
    planState: tip === undefined ? { kind: "no-commit" } : { kind: "seeded", tip },
  };
}

/**
 * The template with every occurrence of {@link STATE_ROOT_TOKEN} replaced,
 * or a throw if any `{{…}}` placeholder survives.
 *
 * The refusal is the point: a template that grew a second placeholder would
 * otherwise ship a protocol page whose prose reads as a literal brace token
 * to every consumer who opens it, and nothing downstream would notice
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 */
function renderProtocol(template: string, stateRoot: string): string {
  const rendered = template.split(STATE_ROOT_TOKEN).join(stateRoot);
  const leftover = rendered.match(/\{\{[^}]*\}\}/g);
  if (leftover) {
    throw new Error(
      `flume-harness init: the shipped ${PROTOCOL_REL} template carries ` +
        `placeholders init does not substitute: ${[...new Set(leftover)].join(", ")}`,
    );
  }
  return rendered;
}

/**
 * The manifest fields a package can already be declared in, in the order
 * {@link addDependency} looks for one.
 */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies"] as const;
type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

/**
 * A parsed consumer manifest whose dependency fields init has already
 * resolved: each one is a JSON object or absent, never a scalar, a list or a
 * `null` that a spread would quietly turn into something else. The type is
 * what carries that guarantee from the read to the write, so no arm of
 * {@link addDependency} reads a shape {@link readConsumerManifest} did not
 * refuse.
 */
type ConsumerPkg = Record<string, unknown> & {
  [Field in DependencyField]?: Record<string, unknown>;
};

/** The consumer's `package.json` as init read it, before anything was written. */
interface ConsumerManifest {
  /** Where it sits, absolute — the plain spelling, which is what gets reported. */
  readonly path: string;
  /** What it declared, parsed and with its dependency fields resolved. */
  readonly pkg: ConsumerPkg;
}

/** Whether `value` is a JSON object — not a list, not `null`, not a scalar. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The shape a refusal names, in the alphabet `JSON.parse` hands back. */
function jsonShape(value: unknown): string {
  if (Array.isArray(value)) return "an array";
  return `a JSON ${value === null ? "null" : typeof value}`;
}

/**
 * The repository's `package.json`, parsed — or `undefined` when it has none,
 * which is the degraded-but-proceeding case {@link DependencyOutcome}'s
 * `absent` variant reports and bounds.
 *
 * A manifest that is present but unreadable is a different thing entirely: an
 * unresolved input the whole adoption is downstream of, so it throws in
 * flume's own voice naming the file. The read happens **here**, in init's
 * pre-write phase beside `readSelfPackage`, rather than at the dependency
 * write it feeds — deferred, its `JSON.parse` escapes as a bare `SyntaxError`
 * only after the state root, three skeleton files and the `.gitignore` merge
 * have landed, and the re-run that would surface it refuses on the state root
 * it just created instead (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * A manifest that parses to something that is not a JSON object fails the
 * same way for the same reason: `dependencies` cannot be read off it, and
 * reaching the write to discover that is the defect above wearing a
 * `TypeError`.
 *
 * So does an object that hangs something other than an object off
 * `dependencies` or `devDependencies`. That shape does not throw at the write
 * at all — spreading a string yields a map of its characters, spreading a
 * scalar or a list yields an empty one — so the adoption rewrites the
 * consumer's manifest into something they never declared and reports it as a
 * dependency added. It is refused here, by field name, before the first byte.
 */
async function readConsumerManifest(
  repoRoot: string,
): Promise<ConsumerManifest | undefined> {
  const path = join(repoRoot, "package.json");
  if (!existsLoud(namespacedJoin(path))) return undefined;

  const source = await readFile(namespacedJoin(path), "utf8");
  const refuse = (why: string): never => {
    throw new Error(
      `flume-harness init: ${path} could not be read as a package manifest ` +
        `(${why}) — refusing to adopt into a repository whose manifest ` +
        `init cannot add its dependency line to. Nothing has been written; ` +
        `fix the manifest and run init again.`,
    );
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return refuse(detailOf(error));
  }
  if (!isJsonObject(parsed)) {
    return refuse(`it parsed as ${jsonShape(parsed)}, not an object`);
  }
  for (const field of DEPENDENCY_FIELDS) {
    const value = parsed[field];
    if (value !== undefined && !isJsonObject(value)) {
      refuse(`its ${field} field is ${jsonShape(value)}, not an object`);
    }
  }
  return { path, pkg: parsed as ConsumerPkg };
}

/**
 * Declare `name` at `range` in the consumer's already-parsed manifest, and
 * report what that took.
 *
 * Edits the manifest's `dependencies` and nothing else — no lockfile, no
 * install, no package-manager choice. Which manager reconciles
 * `node_modules` against the manifest is the consumer's, and a library verb
 * that spawned one would be making that choice for every adopter
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 *
 * Every field read here is an object or absent by the time this runs —
 * {@link readConsumerManifest} refuses anything else in init's pre-write
 * phase — so no arm reconciles a shape of its own.
 *
 * The rewrite is `JSON.stringify` at two-space indent with a trailing
 * newline — npm's own normalization, so a manifest npm wrote round-trips and
 * one it did not is reformatted once, visibly, in the adoption commit.
 */
async function addDependency(
  manifest: ConsumerManifest | undefined,
  name: string,
  range: string,
): Promise<DependencyOutcome> {
  if (manifest === undefined) return { kind: "absent", range };
  const { path, pkg } = manifest;

  for (const field of DEPENDENCY_FIELDS) {
    const declared = pkg[field]?.[name];
    if (typeof declared === "string") {
      return { kind: "declared", manifest: path, range: declared };
    }
  }

  const dependencies: Record<string, unknown> = {
    ...(pkg.dependencies ?? {}),
    [name]: range,
  };
  pkg.dependencies = Object.fromEntries(
    Object.keys(dependencies)
      .sort()
      .map((key) => [key, dependencies[key]]),
  );
  await writeFile(
    namespacedJoin(path),
    `${JSON.stringify(pkg, null, 2)}\n`,
    "utf8",
  );
  return { kind: "added", manifest: path, range };
}
