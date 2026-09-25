/**
 * The `flume-harness` help page — the job `src/cliHelp.ts` holds for the
 * engine's verbs, held here for the harness package's own bin
 * (`spec/cli.md`, *Distribution*).
 *
 * Its own module rather than a literal beside the argv half, for the reason
 * the engine's page has one: `cli.ts` runs its `main` at import, so a page
 * spelled there is the one shipped surface no suite may import to read
 * (`.claude/rules/engineering.md`, *A module is one job*). Here it is a
 * value, and the scan that reads every help page this package prints reads
 * this one on the same terms as the engine's.
 */

import { DEFAULT_STATE_ROOT } from "./init.js";

/**
 * The whole page `flume-harness --help` prints, and the trailer both of the
 * command line's usage refusals print under their own first line.
 */
export const HARNESS_HELP = `flume-harness — adopt flume's harness package in this repository.

Usage: flume-harness <command>

Commands:
  init                Write the declaration skeleton, the chain.ts that
                      applies the package's factory to it, the package.json
                      scoping both as ESM, the state root, the runtime
                      ignore lines and ${DEFAULT_STATE_ROOT}/PROTOCOL.md into
                      the current directory, and declare the package in its
                      package.json.
                      Refuses if ${DEFAULT_STATE_ROOT}/ is already there.

Options:
  -h, --help          Print this message.
`;
