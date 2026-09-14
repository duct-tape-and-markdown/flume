#!/usr/bin/env node

// Node counterpart to bin/flume (POSIX sh): npm's generated Windows shims
// (.cmd/.ps1) invoke this directly with node.exe, so no sh.exe hunt. Node
// resolves its own module path, so the symlink-walk bin/flume needs isn't
// needed here.
//
// The spawn, the inherited stdio and the exit-code/signal propagation are
// bin/execEntry.js's, shared with bin/flume-harness.js.

import { execEntry } from "./execEntry.js";

execEntry(import.meta.url, "dist", "src", "cli.js");
