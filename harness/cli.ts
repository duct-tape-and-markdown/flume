/**
 * `flume-harness` — the harness package's own command line, and the module
 * `bin/flume-harness.js` runs (`spec/cli.md`, *Distribution*).
 *
 * **Its own entry point, deliberately.** The verb it runs lives in
 * `init.ts`, which the package also exports; this module is the argv half
 * and nothing else, so importing the verb from a chain never runs a command.
 * Nothing imports this module, which is why it needs no invoked-directly
 * guard: it runs when it is executed and at no other time.
 *
 * **The engine's verb set stays closed.** `flume` gains no adoption verb and
 * `src/` imports nothing from this directory — the reason this bin exists at
 * all (`spec/harness.md`, *Adoption and upgrade*).
 */

import { relative } from "node:path";

import { detailOf } from "./exec.js";
import { DEFAULT_STATE_ROOT, harnessInit } from "./init.js";

const HELP = `flume-harness — adopt flume's harness package in this repository.

Usage: flume-harness <command>

Commands:
  init                Write the declaration skeleton, the chain.ts that
                      applies the package's factory to it, the state root,
                      the runtime ignore lines and PROTOCOL.md into the
                      current directory, and declare the package in its
                      package.json.
                      Refuses if ${DEFAULT_STATE_ROOT}/ is already there.

Options:
  -h, --help          Print this message.
`;

/**
 * sysexits.h `EX_USAGE` — the caller's command line, not the repository's
 * state (`.claude/rules/platform-facts.md`, *Exit codes come from
 * sysexits.h*). A refusal over what is on disk exits 1 instead.
 */
const EX_USAGE = 64;

async function main(argv: readonly string[]): Promise<number> {
  const [verb, ...rest] = argv;

  if (verb === undefined || verb === "-h" || verb === "--help") {
    process.stdout.write(HELP);
    return 0;
  }

  // Two usage refusals, told apart because they are acted on differently: a
  // verb that does not exist, and the one that does carrying arguments it
  // has none of.
  if (verb !== "init") {
    process.stderr.write(`flume-harness: unknown command \`${verb}\`\n\n${HELP}`);
    return EX_USAGE;
  }
  if (rest.length > 0) {
    process.stderr.write(
      `flume-harness: \`init\` takes no arguments, got \`${rest.join(" ")}\`\n\n${HELP}`,
    );
    return EX_USAGE;
  }

  const result = await harnessInit({ repoRoot: process.cwd() });
  const here = (path: string): string => relative(result.repoRoot, path) || path;

  const lines = result.written.map((path) => `  wrote     ${path}`);
  lines.push(
    result.ignoreLines.length === 0
      ? `  ignores   .gitignore already carried every runtime line`
      : `  ignores   .gitignore +${result.ignoreLines.length} line(s) under ${result.stateRoot}/`,
  );
  // A fact, never a verdict: what the manifest says now, leaving the install
  // — and which package manager runs it — to the operator.
  lines.push(
    result.dependency.kind === "added"
      ? `  depends   ${result.packageName}@${result.dependency.range} added to ${here(result.dependency.manifest)}`
      : result.dependency.kind === "declared"
        ? `  depends   ${here(result.dependency.manifest)} already declares ${result.packageName}@${result.dependency.range}`
        : `  depends   no package.json here — add ${result.packageName}@${result.dependency.range} wherever this repository declares its dependencies`,
  );

  process.stdout.write(
    `flume-harness init — ${result.repoRoot}\n\n${lines.join("\n")}\n\n` +
      `Next: install the dependency, then edit ${result.stateRoot}/declaration.ts — ` +
      `its \`specLocus\`, \`fence\` and \`slices\` are placeholders.\n`,
  );
  return 0;
}

process.exitCode = await main(process.argv.slice(2)).catch(
  (err: unknown): number => {
    process.stderr.write(`${detailOf(err)}\n`);
    return 1;
  },
);
