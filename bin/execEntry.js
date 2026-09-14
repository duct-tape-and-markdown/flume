/**
 * What a published bin shim does, in one place: spawn an emitted entry point
 * under this process's node, argv preserved, stdio inherited, and the child's
 * exit code — or terminating signal — propagated (`spec/cli.md`,
 * *Distribution*).
 *
 * Two shims reach it, `bin/flume.js` and `bin/flume-harness.js`, and the
 * semantics above are one decision with one home: a shim that re-spelled the
 * signal re-raise or the `status ?? 1` fallback is how two entry points come
 * to report a killed child differently (`.claude/rules/engineering.md`, *The
 * fix lands at the mechanism*). A shim's own file carries its shebang, its
 * entry path, and nothing else.
 *
 * Not itself a bin: `package.json`'s `bin` map names the two shims, so npm
 * links those and this module ships beside them as the thing they import.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run the entry at `hops` under the package root, resolved from the calling
 * shim's own `import.meta.url` — never from a cwd, which is the consumer's
 * directory and not the package's.
 *
 * Does not return: the process exits with the child's status, or re-raises
 * its terminating signal so a caller reading `$?` sees what a direct
 * invocation would have shown.
 */
export function execEntry(shimUrl, ...hops) {
  const here = dirname(fileURLToPath(shimUrl));
  const entry = join(here, "..", ...hops);

  const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exit(result.status ?? 1);
  }
}
