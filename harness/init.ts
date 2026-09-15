/**
 * `flume-harness init` — what adopting the harness package writes into a
 * repository (`spec/harness.md`, *Adoption and upgrade*): the declaration
 * skeleton, the `chain.ts` that applies the package's factory to it, the
 * state root, the ignore set, `PROTOCOL.md`, and the dependency
 * line that makes `@dtmd/flume/harness` resolve from the declaration that
 * imports it. The engine refuses a load with no `<configDir>/chain.ts`, so
 * an adoption that stopped at the declaration would leave a repository one
 * hand-written file short of its first tick.
 *
 * **A verb on the harness bin, never on the engine's.** The engine's verb set
 * is closed and `src/` never imports this directory, so an adoption verb on
 * `flume` would be the engine reaching up into flume's opinion about how to
 * run it. The package ships its own bin instead (`spec/cli.md`,
 * *Distribution*), and this module is what that bin's `init` runs.
 *
 * **Every refusal is taken before the first byte is written.** An init that
 * stopped half-way would leave a repository carrying an ignore set for a
 * state root that does not exist, or a `PROTOCOL.md` beside no declaration —
 * a tree nothing refuses and no re-run can distinguish from a finished one.
 * The state root's absence is checked first and nothing on disk is touched
 * until it passes (`.claude/rules/engineering.md`, *Loud or nothing*).
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
import { mergeIgnoreLines } from "../src/job.js";
import { namespacedJoin, STATE_ROOT_DIRNAME } from "../src/paths.js";
import { readSelfPackage } from "../src/selfPackage.js";

import { consumerIgnores } from "./ignores.js";

/** The directory holding this module, in whichever layout it is running from. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The state root a consumer gets unless it says otherwise — the bay name the
 * engine resolves from a repository root when nothing overrides it
 * (`spec/cli.md`, *Bay discovery*). Taken from the engine rather than
 * restated: init's default and the dir the engine's own discovery walk looks
 * for are one fact, and a second spelling here would write an adoption the
 * engine then fails to find (`.claude/rules/engineering.md`, *Derived state
 * is computed, never restated beside its source*).
 *
 * Spelled as a default rather than baked in: everything this module composes
 * takes the root as a parameter, so a consumer adopting into a different one
 * gets a declaration, an ignore set, and a `PROTOCOL.md` that agree about
 * where its state lives.
 */
export const DEFAULT_STATE_ROOT = STATE_ROOT_DIRNAME;

/** Where the declaration sits under a state root (`spec/harness.md`). */
const DECLARATION_REL = "declaration.ts";

/**
 * Where the chain the engine loads sits — `<configDir>/chain.ts` and nowhere
 * else (`spec/chain.md`, *Chain residency*), which for a consumer adopting
 * the package is the state root init just made.
 */
const CHAIN_REL = "chain.ts";

/** Where the project's own conventions sit under a state root. */
const PROTOCOL_REL = "PROTOCOL.md";

/**
 * The placeholder the shipped `PROTOCOL.md` template carries wherever it
 * names the consumer's state root. One token, substituted by value: a
 * template that spelled `.flume` would be silently wrong for every consumer
 * that adopted into another root.
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
}

/**
 * Where the shipped `PROTOCOL.md` template lives on disk — absolute,
 * resolved from this module rather than from any caller's cwd, for the
 * reason `promptPath` (`prompts.ts`) is: it is package content, and the same
 * relative hop has to reach it from a checkout's `harness/` and from the
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
 * default export because a `.ts` module carrying only a default is compiled
 * to CJS interop by the chain loader's `tsImport` — a namespace shape a
 * consumer's `chain.ts` would then have to unwrap.
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
   * with the engine's own API — that is where the base checkout's installer
   * and worktree base come from. The package ships vitest's; a project
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

  // Read before writing, for the same reason: a package whose own manifest
  // cannot be read has no version to write into the consumer's dependency
  // line, and that should leave the repository untouched.
  const self = readSelfPackage(HERE);
  const template = await readFile(protocolTemplatePath(), "utf8");
  const protocol = renderProtocol(template, stateRoot);

  await mkdir(namespacedJoin(stateRootAbs), { recursive: true });
  const written: string[] = [];
  for (const [rel, body] of [
    [DECLARATION_REL, declarationSkeleton(self.name)],
    [CHAIN_REL, chainSkeleton(self.name)],
    [PROTOCOL_REL, protocol],
  ] as const) {
    await writeFile(namespacedJoin(stateRootAbs, rel), body, "utf8");
    written.push(`${stateRoot}/${rel}`);
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
    dependency: await addDependency(repoRoot, self.name, `^${self.version}`),
  };
}

/**
 * The template with every occurrence of {@link STATE_ROOT_TOKEN} replaced,
 * or a throw if any `{{…}}` placeholder survives.
 *
 * The refusal is the point: a template that grew a second placeholder would
 * otherwise ship a `PROTOCOL.md` whose prose reads as a literal brace token
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
 * Declare `name` at `range` in the repository's `package.json`, and report
 * what that took.
 *
 * Edits the manifest's `dependencies` and nothing else — no lockfile, no
 * install, no package-manager choice. Which manager reconciles
 * `node_modules` against the manifest is the consumer's, and a library verb
 * that spawned one would be making that choice for every adopter
 * (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
 *
 * The rewrite is `JSON.stringify` at two-space indent with a trailing
 * newline — npm's own normalization, so a manifest npm wrote round-trips and
 * one it did not is reformatted once, visibly, in the adoption commit.
 */
async function addDependency(
  repoRoot: string,
  name: string,
  range: string,
): Promise<DependencyOutcome> {
  const manifest = join(repoRoot, "package.json");
  const onDisk = namespacedJoin(manifest);
  if (!existsLoud(onDisk)) return { kind: "absent", range };

  const pkg = JSON.parse(await readFile(onDisk, "utf8")) as Record<
    string,
    unknown
  >;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const declared = (pkg[field] as Record<string, unknown> | undefined)?.[name];
    if (typeof declared === "string") {
      return { kind: "declared", manifest, range: declared };
    }
  }

  const dependencies = {
    ...((pkg["dependencies"] as Record<string, string> | undefined) ?? {}),
    [name]: range,
  };
  pkg["dependencies"] = Object.fromEntries(
    Object.keys(dependencies)
      .sort()
      .map((key) => [key, dependencies[key]]),
  );
  await writeFile(onDisk, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return { kind: "added", manifest, range };
}
