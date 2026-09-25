/**
 * scripts/directInvocation.mjs — "was this module the one invoked?", for the
 * scripts in this directory.
 *
 * Compare the caller's `import.meta.url` against `process.argv[1]` resolved
 * through symlinks, so importing a script for its named exports runs no side
 * effect — only running it as a script does. The resolve is what lets a
 * checkout reached through a link or junction still match: node resolves the
 * main entry's URL through links, while `argv[1]` keeps the invoked path
 * verbatim.
 *
 * One home rather than a copy per script, because the detection is the same
 * question at both call sites and a second spelling is the one that drifts
 * (`.claude/rules/engineering.md`, *The fix lands at the mechanism*).
 *
 * This is deliberately shallower than the CLI's own entry check
 * (`onDiskIdentity`, `src/cli.ts`), which namespaces its argument, spends the
 * native binding rather than the JS one, and folds the answer back through
 * `plainPath` (`src/paths.ts`). The divergence is declared here, not an
 * oversight, on two counts:
 *
 * - Those three moves all exist for win32's namespaced alphabet, and this
 *   guard never enters it. It hands `realpathSync` exactly the `argv[1]` a
 *   shell or `pnpm run changelog` supplied and never a `\\?\` path of its
 *   own making, so the JS form is never given the namespaced drive root node
 *   22 throws over, and no answer can come back prefixed that was not passed
 *   in prefixed (`.claude/rules/platform-facts.md`, "realpathSync keeps the
 *   \\?\ prefix only where nothing resolved"). Both sides of the comparison
 *   are already in one alphabet, so there is no fold to spend — on the
 *   resolving leg or on the catch leg's raw path.
 * - Sharing the sibling would not be the one-line import it looks like. The
 *   callers here include a `.mjs` that bare `node` runs, with no TS loader in
 *   front of it, so reaching `src/cli.ts` from this module means either a
 *   built `dist/` or running the release tool under tsx — a build-order
 *   dependency bought for a difference that is inert at these call sites.
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Whether `moduleUrl` — the caller's own `import.meta.url` — is the entry
 * point this process was started on.
 */
export function isDirectInvocation(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  let real;
  try {
    real = realpathSync(invoked);
  } catch {
    real = invoked;
  }
  return moduleUrl === pathToFileURL(real).href;
}
