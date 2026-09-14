/**
 * This repository's chain: the harness package's factory applied to this
 * repository's declaration, and nothing else (`spec/harness.md`, *What this
 * repo is*). Flume is the package's reference consumer — every slice, prompt,
 * judge, gate and record convention comes from `harness/`, where every
 * consumer gets it. A behavior this repo wants and the package lacks belongs
 * in `harness/`, never here.
 *
 * Imports the runtime from `../src/` and the package from `../harness/`
 * because this is flume operating on flume (CLAUDE.md, *Source of truth*);
 * a consumer writes `@dtmd/flume` and `@dtmd/flume/harness` instead.
 */

import type { ChainFactory } from "../src/Dispatcher.ts";
import { harnessChain } from "../harness/index.ts";
import { declaration } from "./declaration.ts";

const factory: ChainFactory = (api) => ({ chain: harnessChain({ api, declaration }) });

export default factory;
