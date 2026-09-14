#!/usr/bin/env node

// `bin.flume-harness` — the bin the package ships beside the engine's
// `flume`, so the engine's verb set stays closed and never imports the
// harness (spec/harness.md, "Adoption and upgrade"; spec/cli.md,
// "Distribution").
//
// Identical in shape to bin/flume.js and different only in the entry it
// reaches: the spawn, the inherited stdio and the exit-code/signal
// propagation are bin/execEntry.js's.

import { execEntry } from "./execEntry.js";

execEntry(import.meta.url, "dist", "harness", "cli.js");
