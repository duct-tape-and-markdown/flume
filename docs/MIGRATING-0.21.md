# Migrating to 0.21.0

**This note covers `0.20.x` → `0.21.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.20.md`](MIGRATING-0.20.md), which walks
`0.19.x` → `0.20.0`. If your pin is below `0.20.0`, work that note first.

Three breaks, all at the chain-authoring surface, and five behavior changes
worth knowing before the first run.

**Upgrade from a stopped loop.** Run `flume stop`, let the in-flight tick
finish, then upgrade and remove the stop flag. The supervisor stays resident
at its launch version, and this release changes the branch grammar and the
tip claim it shares with its children.

## 1. The render helpers leave the root's value surface

`renderPrompt` and `readPhaseTemplate` are no longer value exports of
`@dtmd/flume`. A chain factory already receives both on `api`; the refusal
classes they throw (`RenderRefusal`, `InlineExecRenderError`,
`PromptTemplateUnreadableError`) ride `api` as values, and the root names
only their types.

**What to do.** Replace a root import with the `api` member:

```ts
// before
import { renderPrompt } from "@dtmd/flume";
// after — inside the factory
export default (api: FlumeApi) => ({ /* … */ api.renderPrompt(/* … */) });
```

Standalone rendering outside a chain is the `flume render` verb.

## 2. `renderPrompt` takes the template's bytes

`RenderOptions.promptFile` is gone. `renderPrompt` takes `template`, the
prompt file's contents, because a tick now reads its templates once with its
chain and renders every slot from those bytes.

**What to do.** Load the template first:

```ts
const template = await api.readPhaseTemplate(configDir, phase.promptPath);
const prompt = await api.renderPrompt({ template, /* args, phase, flumeDir … */ });
```

A template that will not read throws `PromptTemplateUnreadableError`.

## 3. `chainLoader` returns `LoadedChain`

`DispatcherOptions.chainLoader` now returns `Promise<LoadedChain>`: the chain
module beside the `worktreesBase` its load evaluated. Only code that injects
a loader in-process — a test calling `Dispatcher.tick()` directly — is
affected.

**What to do.** Return the base beside the module; `undefined` means the chain
declared none. A `worktreesBase` callback on a chain handed to an injected
loader is never run — pass the string the loader would have evaluated.

## 4. Behavior changes a consumer notices first

- **Log lines carry an ISO-8601 UTC instant.** A log scraper keyed on a
  leading `[flume]` must allow the stamp before it.
- **Tick branches are `flume/<checkout>/<slug>`**, not `flume/<slug>`. Branches
  a 0.20 run left under the old grammar are not the engine's to remove; delete
  any that remain with `git branch -D` once the loop is stopped.
- **A build tick runs as long as there is disjoint work.** A wave refills freed
  slots, so one `build` tick can ship many entries over hours. `flume status`
  totals its spend as agents return.
- **A platform wall aborts after three identical preempts** (`abortThreshold`,
  chain-overridable), instead of spending `--max`. An expired login now ends
  the run early; log in again and relaunch.
- **`flume status` and `flume render` create nothing.** A fresh clone's state
  root stays empty until the first `wake`.

## 5. CI lanes read a red on an ancestor

A lane whose newest completed run tested an ancestor of the tip reads that
run's failures as **red-standing** findings, where 0.20 read it as `UNREAD`.
Closing a finding still needs a run on the tip itself. Expect red lanes to
reach the drain while the loop is busy; a green on a stale run still closes
nothing.
