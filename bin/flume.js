#!/usr/bin/env node

// Node counterpart to bin/flume (POSIX sh): npm's generated Windows shims
// (.cmd/.ps1) invoke this directly with node.exe, so no sh.exe hunt. Node
// resolves its own module path, so the symlink-walk bin/flume needs isn't
// needed here.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
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
