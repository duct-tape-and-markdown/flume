# Runner — Claude + Flume Compilation (verbatim)

This is a faithful dump of the Claude harness, project rules, slash
commands, skills, plugin manifest + hooks, and Flume configuration as
they exist in `/home/johnc/repos/runner` at compilation time. Each
artifact is shown in full, headed by its absolute path from the repo
root. Nothing has been abstracted, deduplicated, or rewritten — that's
the next step.

Runtime artifacts (`.flume/sessions/`, `.flume/worktrees/`,
`.flume/awake/`) are not included: they are per-run state, not
configuration.

Tree:

```
CLAUDE.md
.claude/
  settings.json
  settings.local.json
  commands/
    core.md
    deliberate.md
    gate.md
    multidim-review.md
    no-guesses.md
    report.md
  rules/
    cli-bundle.md
    code-navigation.md
    collaboration.md
    memory.md
    spec-plan-build.md
  skills/
    grill/SKILL.md
.claude-plugin/
  marketplace.json
plugins/runner/
  package.json
  .claude-plugin/plugin.json
  commands/init.md
  hooks/hooks.json
  hooks/attest-read.mjs
  skills/runner/SKILL.md
  skills/runner/references/emit-discipline.md
.flume/
  PROTOCOL.md
  chain.ts
  inbox.md
  prompts/plan.md
  prompts/build.md
  plan/pending.json
  plan/state.md
  plan/open-questions.md
```

---

## `CLAUDE.md`

```markdown
# Runner

## Identity

- Project: Runner — corpus-agnostic knowledge compilation tool. Central Postgres-backed server stores propositions (the intent tier) distilled by LLM agents from any URI-addressable source. The structural tier (cartograph, LSP, ctags, any NDJSON producer) is a query-time concern, lives in the agent's environment, never in the central DB.

## Source of truth

**Read `spec/SPEC.md` first.** It is the canonical v0.1.0 design — architecture, data model, HTTP API, emit contract, freshness model, deploy shape, onboarding, skill behavior. `spec/RESEARCH.md` carries the research grounding (Dense X, HyperGraphRAG, RRF). Historical material lives in `spec/archive/`.

## Tech Stack

- Node 22, TypeScript, pnpm
- Postgres 16 + pgvector (local docker for dev; Neon as managed target)
- Hono server, `pg` over TCP (LISTEN/NOTIFY), zod
- Test: vitest

Stack-specific conventions belong in `.claude/rules/<area>.md` and should be path-scoped where possible.

## Workflow: Flume

Two autonomous phases (plan, build) sharing one TypeScript dispatcher. Chain config in `.flume/chain.ts`; per-phase prompts in `.flume/prompts/{plan,build}.md`. Runtime installed as the `flume` pnpm dep (`Jwcjwc12/flume`). Run via `pnpm exec flume` (subcommands: `tick`, `loop`, `status`, `wake`, `sleep`, `render`). Plan output is structured JSON at `.flume/plan/pending.json`; prose at `.flume/plan/{state,open-questions}.md`. State on disk; each tick is a fresh `claude -p`. Loops are autonomous — no slash command invokes them.

Project conventions for the chain live in `.flume/PROTOCOL.md`.

**Pushback is the point.** Never silently fill product/UX gaps — challenge them. See @.claude/rules/collaboration.md.

## Common Commands

- `pnpm tsc --noEmit` — typecheck
- `pnpm test` — vitest
- `pnpm exec flume status` — baton state
- `pnpm exec flume tick` — one tick of whichever phase is awake
- `pnpm exec flume loop` — autonomous loop until hibernation

## Quality Standard: Six Gates

Product: **Valuable**, **Usable**, **Delightful**. Engineering: **Safe**, **Fast**, **Reliable**. Chain-config gates validate engineering each tick; broader product/UX pressure-test is human.

## Non-Negotiables

- Build phase commits + pushes per Pending entry directly to `main` after green validation.
- NEVER force-push, amend pushed commits, or `--no-verify`.
- NEVER modify files when asked to investigate — investigate and report.
- Search the codebase before implementing — don't assume not implemented.
- Never silently fill a gap in a spec — challenge it.
```

---

## `.claude/settings.json`

```json
{
  "autoMemoryEnabled": false,
  "hooks": {
    "PostCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'IMPORTANT: Context was compacted. Run /core to re-inject project rules.'"
          }
        ]
      }
    ]
  },
  "enabledPlugins": {
    "frontend-design@claude-plugins-official": true,
    "freelance@freelance-plugins": true,
    "typescript-lsp@claude-plugins-official": true
  }
}
```

---

## `.claude/settings.local.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(mkdir -p decisions open-questions research)",
      "Bash(node --version)",
      "Bash(npm --version)",
      "Bash(git add working/playground/semantic-search-intro.html .gitignore reference/source-documents/nathan-john-sync-summary.md)",
      "Bash(git commit:*)",
      "Bash(git fetch origin)"
    ]
  },
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": [
    "task-master-ai"
  ]
}
```

---

## `.claude/commands/core.md`

```markdown
# /core — Re-inject non-negotiable rules

Re-read and internalize the project's core context. Use this after long sessions, after auto-compaction, or whenever you suspect context drift.

## Instructions

1. Read `CLAUDE.md` in the project root. Internalize every rule. Note the current **project phase**.

2. Read the **deliberation guide** (`working/deliberation.md`). Understand the outside-in framework:
   - Who needs knowledge (personas and user stories)
   - When they need it (triggers and latency requirements)
   - Through what they access it (mechanisms — CLI, MCP, API, LSP)
   - What this tells us about architecture (derived requirements)

3. Read `working/plans/00-context.md` — the project map. Know what's decided, what's blocking, and what's being explored.

4. Read the **architecture specs** — understand the system design:
   - `docs/architecture.md` — the 4-layer system
   - `docs/document-model.md` — the dimensional model and schema
   - `docs/lenses.md` — the filter + prompt configuration pattern

5. Scan the **decision and question indexes**:
   - `decisions/README.md` — what's been decided
   - `open-questions/README.md` — what's blocking and what's open

6. Confirm: "Core context re-loaded. Project is in [current phase]. I understand the 4-layer architecture, the dimensional model, the lens system, the outside-in deliberation framework, and all non-negotiable rules from CLAUDE.md. [N] decisions are accepted, [N] questions are open ([N] blocking)."

7. Suggest the next step based on the current state of the deliberation guide and open questions.

Do NOT summarize the documents. Internalize them and confirm.
```

---

## `.claude/commands/deliberate.md`

```markdown
# /deliberate — Work through an open question

Structured deliberation on an open design question. Grounds abstract questions in the personas and user stories from the deliberation guide.

## Instructions

1. Read `CLAUDE.md` and `working/deliberation.md` to load current context.

2. Read `open-questions/README.md` to see all open questions and their status.

3. **Determine the target question:**
   - If `$ARGUMENTS` names a specific question, read that file from `open-questions/`.
   - If `$ARGUMENTS` is empty, identify the highest-priority unresolved question (blocking > scoping > deferrable).

4. **Load the question's full context:**
   - Read the open question file.
   - Read any ADRs, research, or docs it references.
   - Read relevant sections of `working/deliberation.md` (personas, triggers, mechanisms).

5. **Ground the question in user stories:**
   - For each option in the open question, trace it through at least 2 personas from the deliberation guide.
   - Ask: "If we chose Option A, what would the support engineer's experience be? The PM's? The engineer's?"
   - Ask: "Does this option make a mechanism (CLI, MCP, API) easier or harder to build?"

6. **Evaluate the options:**
   - What evidence supports each option? (research, team input, analogous systems)
   - What evidence is missing? What would answer the question definitively?
   - What's the cost of choosing wrong? (reversible vs irreversible)
   - What's the cost of not deciding? (blocking other work vs can defer)

7. **Present findings:**

```
## Deliberation: [Question Title]

### Grounded in User Stories
[How each option affects real personas and their scenarios]

### Evidence For/Against Each Option
[What we know, what we don't, what would help]

### Reversibility Assessment
[How hard is it to change this decision later?]

### Recommendation
[If the evidence points clearly: recommend and explain why]
[If not: state what's needed to decide, and propose how to get it]

### If Accepted as a Decision
[Draft ADR title and number for the decision]
[What open questions does this unblock?]
```

8. Ask the user whether to:
   - **Accept** — Convert to an ADR in `decisions/`, update the open question status
   - **Research further** — Identify specific next steps to gather missing evidence
   - **Defer** — Document why and move on to next priority question
   - **Discuss** — Bring to the team with specific framing

9. Suggest the next step.

## Arguments

$ARGUMENTS — Optional. An open question name (e.g., "dimensional-model-validation", "consumer-interface") or topic. Defaults to the highest-priority blocking question.
```

---

## `.claude/commands/gate.md`

```markdown
# /gate — Run quality gate checks

Evaluate current work against the 6 Gates framework. Adapts to the current project phase.

## The 6 Gates

**Product Gates** (Is it worth building?):
| Gate | Question |
|------|----------|
| **Valuable** | Does it produce value for customers, for us, or both? |
| **Usable** | Can customers actually use it and realize the value? |
| **Delightful** | Will they want to use it over competitors? |

**Engineering Gates** (Is it built right?):
| Gate | Question |
|------|----------|
| **Safe** | Is it secure? Is it compliant? |
| **Fast** | Is it responsive at relevant scale? |
| **Reliable** | Will it present nasty surprises (bugs)? |

## Instructions

1. Read `CLAUDE.md` to determine the current **project phase**.

2. **If phase is "Implementation planning"** — evaluate readiness and planning:

   | Gate | Implementation Planning Question |
   |------|-----------------------------------|
   | **Valuable** | Do the locked architectural decisions (ADR 007, runner-as-environment) deliver on the persona needs in `working/deliberation.md`? |
   | **Usable** | Is the phase plan (`working/plans/00-context.md`) clear enough for a developer to execute without re-discovering architecture? |
   | **Delightful** | Does the roadmap lead to a user-facing experience that's compelling vs the status quo? |
   | **Safe** | Are blocking open questions (dimensional-model-validation, consumer-interface) scoped tightly enough to resolve without rearchitecting? |
   | **Fast** | Is Phase 0 (core system) small and focused? Are non-blockers deferred to later phases? |
   | **Reliable** | Do the phase descriptions include acceptance criteria? Will "done" be unambiguous? Do they reference gate criteria? |

3. **If phase is "Architectural deliberation"** — evaluate design artifacts:

   | Gate | Deliberation-Phase Question |
   |------|-----------------------------|
   | **Valuable** | Do the personas and user stories in `working/deliberation.md` represent real needs? Are we solving a problem that matters? |
   | **Usable** | Can the proposed mechanisms (CLI, MCP, API) actually deliver knowledge to the personas in their real contexts? |
   | **Delightful** | Is the proposed experience better than what exists (searching 3 systems, asking a colleague)? |
   | **Safe** | Do decisions in `decisions/` have adequate rationale? Are we making irreversible choices without enough evidence? |
   | **Fast** | Are we deliberating efficiently? Are blocking questions getting resolved? Are we stuck? |
   | **Reliable** | Is the deliberation framework internally consistent? Do open questions have clear resolution criteria? Do decisions reference research? |

3. **If phase is implementation** — evaluate code and changes:

   For each relevant gate, evaluate:
   - **Status**: Pass / Concern / Fail
   - **Evidence**: What you observed (cite specific files/lines)
   - **Action**: What to fix (if Concern or Fail)

4. Determine scope: If `$ARGUMENTS` specifies a gate (e.g., "safe", "fast"), check only that gate. If `$ARGUMENTS` specifies a feature, file, decision, or open question, check all relevant gates for that scope. If empty, check all gates against current state.

5. Output a gate report:
```
## Gate Report: [scope]
**Phase:** [current phase]

| Gate | Status | Notes |
|------|--------|-------|
| Valuable | ... | ... |
| Usable | ... | ... |
| Delightful | ... | ... |
| Safe | ... | ... |
| Fast | ... | ... |
| Reliable | ... | ... |

### Actions Required
- [ ] ...
```

6. If all gates pass: "All gates pass."
   If any gate fails: "Gate failures found. Address the actions above before proceeding."
7. Suggest the next step.

## Arguments

$ARGUMENTS — Optional. A specific gate name (e.g., "safe"), a feature name, a decision (e.g., "ADR 001"), or an open question. Defaults to all gates on current state.
```

---

## `.claude/commands/multidim-review.md`

```markdown
# /multidim-review — Multi-dimensional review via Claude Code Agent Teams

Runs a parallel 6-reviewer audit of the current Runner surface (or a named subset) and appends a synthesized findings section to `.flume/inbox.md` for the next plan tick to drain.

## Preconditions

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json` (`env` block) or the process environment. Verify before starting; if missing, stop and tell the user to enable + restart.
- Claude Code 2.1.32 or later (`claude --version`).
- `spec/SPEC.md` exists. The relevant waypoint doc (`spec/WAYPOINT-*.md`) exists if reviewing a waypoint-scoped surface.

## Inputs

`$ARGUMENTS` — Optional. The round label (e.g., "W1.5 hardening", "post-RUNNER-INIT", "src/jobs only"). Used to title the new section and to scope each reviewer's brief.

If `$ARGUMENTS` is empty, ask the user what's being reviewed and why — don't pick silently.

## Protocol

1. **Orient.** Read `spec/SPEC.md`, the relevant `spec/WAYPOINT-*.md` if applicable, `.flume/plan/state.md`, `.flume/plan/open-questions.md`, `.flume/inbox.md` (to avoid duplicating findings already queued), and `git log -20`. Identify what's in the round's scope and what's deferred.

2. **Research, where it pays.** Where the review touches a domain whose best practice moves fast (pgvector indices, Hono/Express CVEs, Node LTS, OWASP top 10, OpenAI SDK), run 3-5 targeted web searches for current-year guidance. Pull the relevant findings into the reviewer briefs as "best-practice context" so reviewers can apply them rather than rediscover.

3. **Create the team.** `TeamCreate` with `team_name = review-YYYY-MM-DD` (or include a label slug). `agent_type: "team-lead"`.

4. **Create 6 tasks** via `TaskCreate`, one per reviewer (see roster below). Each task description states the round's scope guardrails (what's in, what's W2/deferred and shouldn't be flagged as a gap).

5. **Spawn 6 teammates in parallel** via `Agent` calls — one message with six tool blocks. Each `Agent`:
   - `team_name`: the team
   - `name`: the reviewer role from the roster
   - `subagent_type`: `general-purpose` for all except `bryan` which uses `bryan-senior-engineer-architect`
   - `prompt`: a self-contained brief that includes: file pointers, scope guardrails, the best-practice context gathered in step 2, output format. Each prompt must instruct the reviewer to:
     - Mark its task `in_progress` then `completed` via `TaskUpdate`
     - Send findings to `team-lead` via `SendMessage` as a markdown report
     - **Issue reports, not fix prescriptions** — observe and point, don't prescribe
     - **Do not modify any files** (project rule: `CLAUDE.md` — investigation, not editing)

6. **Wait for findings.** Reviewer messages arrive as new turns. Be patient — don't poll or comment on idle teammates. Six reports back = synthesize.

7. **Synthesize.** Build one inbox entry — a single `## YYYY-MM-DD — <label> (multidim-review)` subsection — under the marker in `.flume/inbox.md`. Shape:
   - `### Status` — short paragraph
   - `### How this round was produced` — reviewer roster + method
   - `### Cross-agent convergence` — table showing which reviewers independently flagged each finding (independent flags = confidence signal)
   - `### Findings — <area>` — grouped by area (production-readiness, security, data layer, spec drift, code quality, tests, or whatever fits the round)
   - `### Out of scope — confirmed clean` — what's deferred and verified not partially-implemented
   - `### Notable absences (what's correct)` — what reviewers checked and didn't find (so future rounds don't re-litigate)
   - `### Sources` — links applied during research

   Each finding cites: severity (HIGH/MED/LOW/INFO), `file:line` or `SPEC §X`, what (the observation, not a recommended fix), reviewer lens.

8. **Append to inbox, don't replace.** New `## YYYY-MM-DD — <label> (multidim-review)` section goes immediately below the `<!-- entries below this line; newest first -->` marker, above older entries. Plan drains this on its next tick (each finding becomes a pending entry, an open question, or accepted-debt). **Do not edit `.flume/plan/*` from this skill** — that's plan's lane.

9. **Shut down the team.** `SendMessage` with `{type: "shutdown_request"}` to each teammate (parallel — six tool blocks in one message). Wait for the six shutdown_approved notifications, then `TeamDelete`.

10. **Stop.** Do not commit unless the user asks. Do not promote findings to `.flume/plan/pending.json` — that's the plan phase's call when it drains the inbox.

## Reviewer roster

| Name | Lens | Subagent type |
|---|---|---|
| `spec-reviewer` | Drift, gaps, undocumented additions vs `spec/SPEC.md` + the round's scope doc | `general-purpose` |
| `bryan` | Structure, type safety, error handling, async discipline, production-readiness, dep hygiene | `bryan-senior-engineer-architect` |
| `simplifier` | Duplication, dead code, premature abstractions, unused deps, test-as-design-pressure | `general-purpose` |
| `security-reviewer` | OWASP categories, Hono/Express CVE exposure, auth, secrets, hardening gaps | `general-purpose` |
| `db-reviewer` | Schema fidelity, pgvector index choice + operator alignment, transaction safety, FTS construction | `general-purpose` |
| `test-reviewer` | Contract coverage, hermeticity, brittleness, the skipped tests, test code quality | `general-purpose` |

Adjust the roster only if a lens is irrelevant to the round (e.g., a docs-only change drops `db-reviewer`). Adding a lens is fine; default is these six.

## Output principles

- **Issue reports, not prescriptions.** Reviews observe and point. Fix shape and sequence belong in the plan phase. Strip any "Fix:" / "Recommend:" prose during synthesis — restate as observations with severity.
- **Cross-agent convergence is the confidence signal.** Surface it in the table at the top of the round.
- **Cite, don't summarize.** Every finding carries `file:line` or `SPEC §X` so the next reader can verify.
- **Match prose to the medium.** Per `.claude/rules/collaboration.md`: dialogic prose for findings in inbox.md (plan reads, humans read when triaging).

## Arguments

`$ARGUMENTS` — Optional label for this review round (e.g., "W1.5 hardening", "post-RUNNER-INIT"). Used to scope reviewer briefs and title the new section in `.flume/inbox.md`. If empty, ask the user what's being reviewed before proceeding.
```

---

## `.claude/commands/no-guesses.md`

```markdown
# /no-guesses — Verify claims against real sources

Review recent work (code, config, tests, architecture) and verify every non-trivial technical claim against official documentation using web search and WebFetch. No assumptions, no "should work" — only verified facts.

## Instructions

1. **Identify claims to verify.** Scan the recent work for:
   - API usage (SDK methods, function signatures, config options)
   - Library behavior assumptions (mocking patterns, framework internals)
   - Database behavior (SQL semantics, extension requirements, locking)
   - Runtime behavior (Node.js APIs, ESM semantics, process lifecycle)
   - Security assumptions (what's actually prevented, what's not)

2. **Research each claim.** For every non-trivial claim:
   - Use `WebSearch` to find the official docs or authoritative source
   - Use `WebFetch` to read the actual documentation page
   - If the docs are ambiguous, check GitHub issues or source code
   - Record what was verified and what the source says

3. **Categorize findings.** For each verified claim:
   - **Confirmed**: Claim matches docs exactly. No action needed.
   - **Must-fix**: Claim is wrong. Code will break or behave incorrectly.
   - **Should-fix**: Claim is technically wrong but low-impact. Fix anyway.
   - **Non-issue**: Initially suspicious but verified correct after research.

4. **Report results.** Present findings in a table:

   | Finding | Category | Source | Action |
   |---------|----------|--------|--------|
   | ... | must-fix / should-fix / confirmed | URL or doc reference | What to change |

5. **Do not guess.** If you can't find authoritative documentation for a claim, say so explicitly. "I couldn't verify this" is better than "this should be fine."

## What counts as "non-trivial"

- Any third-party API call or config option
- Any assumption about how a library handles edge cases
- Any security boundary claim
- Any concurrency or ordering assumption
- Any claim about defaults, limits, or thresholds

## What doesn't need verification

- Basic language features (TypeScript types, `Array.map`, etc.)
- Project-internal logic (our own functions calling our own functions)
- Arithmetic and string operations
```

---

## `.claude/commands/report.md`

```markdown
# /report — Read-only investigation mode

Safety latch. Use this when investigating code, debugging, or exploring unfamiliar areas. Prevents accidental modification.

## Instructions

You are now in READ-ONLY investigation mode.

**Rules for this mode:**
- Do NOT create, edit, write, or delete any files.
- Do NOT run any commands that modify state (no git commits, no installs, no writes).
- You MAY read files, search code, run read-only commands, and analyze.
- You MAY run tests if they are non-destructive.

**Where to look** (in order of relevance):
- `working/deliberation.md` — active deliberation framework
- `working/plans/00-context.md` — project map (decisions, blockers, explorations)
- `decisions/` — accepted ADRs
- `open-questions/` — active design questions
- `research/` — findings that inform decisions
- `docs/` — architecture specs
- `explorations/` — future work thinking
- `reference/` — external inputs (meeting notes, colleague plans)

**Your job:** Investigate the topic or question provided. Read relevant files. Trace logic. Form a hypothesis. Report your findings clearly with:

1. **What you found** — facts from the docs/artifacts
2. **What you think** — your interpretation (clearly marked as interpretation)
3. **What you'd recommend** — next steps (but do NOT take them)

When done, state: "Investigation complete. Exiting read-only mode. Awaiting instructions."

## Arguments

$ARGUMENTS — The topic, question, or area to investigate. If empty, ask what to investigate.
```

---

## `.claude/rules/cli-bundle.md`

```markdown
# CLI bundle

`plugins/runner/bin/runner` is a single esbuild bundle of the runner
CLI's import tree, produced by `pnpm bundle` (config: `esbuild.config.mjs`).
Claude Code's plugin loader adds `plugins/runner/bin/` to PATH for any
cwd with the plugin enabled, so the bundle file IS the user-facing
`runner` command. The bundle is the distribution artifact — `dist/` is
local-development tsc output only and is gitignored.

`plugins/runner/package.json` is co-vendored at bundle time with
`{ "version": "...", "type": "module" }`. The `type: module` field is
load-bearing — it keeps Node treating the extensionless bin file as
ESM. The version field is redundant for the bundle itself (the
rewrite plugin below inlines it at bundle time) but stays as a
visible cue for anyone inspecting the plugin tree.

## Regenerate after CLI-tree edits

Any change to a source file reachable from `src/cli.ts`'s import graph
requires a `pnpm bundle` and the regenerated `plugins/runner/bin/runner`
+ `plugins/runner/package.json` in the same commit.

Current CLI tree: `src/cli.ts`, `src/cli-hash.ts`, `src/admin/keys.ts`,
`src/db/client.ts`, `src/migrate.ts`, `src/config.ts`,
`src/config-discovery.ts`, `src/corpus-config.ts`, `src/log.ts`. If
you add a new file to that graph, regenerate too.

`bundleFreshnessGate` in `.flume/chain.ts` reverts any flume build
commit where `pnpm bundle` produces a diff against what was committed.
This rule is the human-readable directive the gate enforces.

**Why:** the bundle is what users execute. Skipping regen ships stale
behavior to anyone who installs the plugin; Claude Code's plugin
loader auto-updates from the git SHA on every commit (per
WAYPOINT-1 §9).

## Dynamic require: use `requireFromHere(<literal>)` exactly

The CLI tree's deliberate "no `@types/pg` / `@types/bcryptjs`" stance
(see comments in `src/db/client.ts` and `src/admin/keys.ts`) requires
runtime requires for `pg`, `bcryptjs`, and `../package.json`. esbuild
can't statically trace through user-named require wrappers, so a naive
`const requireFromHere = createRequire(import.meta.url); requireFromHere('pg')`
pattern would survive bundling and fail at runtime when the bundle
lands on a user's PATH (no `node_modules` to walk to).

The esbuild config carries a `requireFromHereRewritePlugin` that scans
project `.ts` source files and rewrites `requireFromHere(<literal>)`
call sites to `require(<literal>)` before esbuild parses them. The
literal-arg `require` is then statically resolvable, so esbuild inlines
the target into the bundle.

**Contract for source code:**
- Name the wrapper exactly `requireFromHere`. The plugin's regex
  matches that identifier.
- Pass a string literal. Computed paths (`requireFromHere(varExpr)`)
  do not get rewritten and ship as live runtime calls — the bundle
  fails in isolation.
- The wrapper survives in src for the tsx / dist dev paths; it just
  goes dead in the bundled output (its call sites are rewritten away).

## Do not add self-bootstraps to CLI-tree files

Only `src/cli.ts` may carry the `if (import.meta.url === pathToFileURL(process.argv[1]).href)` self-bootstrap block. Library modules in
the CLI tree must not.

**Why:** under bundling all source files share one `import.meta.url`,
so every self-bootstrap in the bundle fires simultaneously. A
library-module self-bootstrap races with `cli.ts`'s dispatch and
silently breaks the bundled command (e.g. `runner --help` parsed by
`admin/keys.ts`'s keygen instead of by commander).
```

---

## `.claude/rules/code-navigation.md`

```markdown
# Code Navigation

## Tools, in order of preference

When navigating or reasoning about code, pick the tool that gives the right level of structural understanding:

### 1. LSP — symbol level

Use for:
- Finding all references to a function, type, or variable across the codebase.
- Looking up a symbol's definition, signature, or surrounding scope.
- Inspecting what an interface or type exposes (members, params, return type).
- Spot-checking a single file's types without running the full `pnpm tsc`.

LSP catches type-level breakage *during* exploration, before the build phase's `tscGate` reverts the commit. Use it as part of the inner loop, not just as a final check.

Provided by the `typescript-lsp` plugin (already enabled in `.claude/settings.json`); requires `typescript-language-server` on PATH (globally installed).

### 2. ast-grep — structural pattern level

Use for:
- Code-shape searches that text grep can't express, e.g. `ast-grep -p 'c.json($X, 400)'` to find every 400-response callsite regardless of variable naming.
- Audits that span the codebase, e.g. `ast-grep -p 'persistEmit($P, $V, $O)'` to verify every emit-call passes options structurally rather than positionally.
- Multi-file pattern rewrites that LSP can't express as a single operation.

Globally available as `ast-grep` (binary 0.42.2). Pattern syntax: https://ast-grep.github.io/guide/pattern-syntax.html.

### 3. Grep / Glob / Read — text level

Use for:
- SQL strings inside `.ts` files (LSP doesn't see them as code).
- Prose, markdown, YAML, SQL migration files, Dockerfiles.
- A single file you already know — LSP overhead exceeds value.
- Initial orientation of an unknown repo, e.g. `glob 'src/**/*.ts'` + `head`.

## When to skip LSP

The bar is: *would symbol-level understanding actually inform the next step?*

- Editing a `.md` / `.yml` / `.sql` / `Dockerfile` — no TS symbols.
- Reading a specific known file end-to-end — Read suffices.
- Looking for a literal string ("DATABASE_URL", a comment) — grep is faster.

If you're navigating or modifying code and you'd lose information by treating it as text, reach for LSP first.
```

---

## `.claude/rules/collaboration.md`

```markdown
# Collaboration

## Push back on weak product/UX specs

**Don't silently fill gaps in product or UX decisions.** Push back, name the weak spots explicitly, propose alternatives, and ask for direction rather than choosing on the user's behalf.

**How to apply:**

- Name the weak spots out loud: "Spec is silent on X — here's what I'd guess, but I'd rather you decide."
- Propose 2-3 alternatives with tradeoffs. Don't pick on the user's behalf.
- Be especially loud about UX flows, error states, empty states, audience considerations, and edge cases.
- Treat liberty-taking as a failure mode. If the spec doesn't say, ask.
- This applies in interactive work AND in autonomous Flume ticks — when a build tick hits a judgment call mid-run, write the open question into `.flume/plan/open-questions.md` instead of deciding silently.

## Inform before parking

Before logging an open question and bailing, the asking agent (plan, build, or interactive) checks the solution landscape:

- Re-read the cited SPEC / WAYPOINT section in full, not just the line the question touches.
- Search the codebase for prior decisions on the same shape.
- Web-search for best practices and established patterns in the same problem domain.

If the research yields a clear answer — one option is unambiguously better, or the question turns out to be a colloquialism with an obvious operational meaning — propose it directly with a one-line cite, skip the park. If it yields options with tradeoffs, capture the options in the question itself so the answering session isn't repeating the research.

**Caveat — architectural missteps.** "Choose the best from the web" only applies when the question is downstream of a sound architectural choice. If the question itself implies an earlier decision was wrong, flag *that* — don't paper over it with a plausible solution.

## Match prose to the medium

Different artifacts ask for different registers. Wrong register makes the artifact harder to use.

**Dialogic — for the human reading.** This-conversation responses, Open Questions in `.flume/plan/open-questions.md`, PR descriptions, commit message bodies. Understandable, reasonably scoped, frame options + tradeoffs, ask. The human is the audience; clarity for them is the bar.

**Telegraphic — for the agent reading itself across ticks.** Pending entries in `.flume/plan/pending.json`, state.md lines, exit log lines. Concise, clear, actionable. Dense with refs the next tick can follow. No ceremony. **You are writing for yourself — write what next-tick-you needs to act, nothing more.**

**Rules** (`.claude/rules/*.md`). Systematic directives declared once. No past-incident anecdotes, no SHA cites. Reasoning condenses to a one-line `**Why:**` when needed; the longer context belongs in the commit message that introduced the directive. A rule says what to do, not what happened.

**Commits.** Imperative. Lead with prefix (`build:`, `plan:`, `chore(flume):`, etc.). Body explains _why_, not what.

## Think before acting — contributor, not blind worker

This is a collaborative project. The agent contributes; it doesn't execute requests literally without thought.

**How to apply:**

- **Understand intent.** The literal request often points at a goal larger than the words. Catch the larger move when it's there.
- **Surface tradeoffs.** When a request has non-obvious alternatives, name them before acting.
- **Push back when something's off.** A plan that doesn't compose, a request that creates friction downstream — say so. Silence is unhelpful.
- **Refuse when refusal serves the project.** "Yes" without thought is worse than "wait."

**Within reason.** Don't second-guess every routine task. The bar is non-trivial actions and consequential commits — anything that changes the harness, restructures shared state, or creates a precedent. Routine reads, edits with clear scope, and obvious mechanical follow-throughs go through without ceremony.
```

---

## `.claude/rules/memory.md`

```markdown
# Memory

**All project context lives in this repo. Auto-memory is disabled (`autoMemoryEnabled: false` in `.claude/settings.json`).**

## Why

Flume ticks run autonomously via `claude -p`. Each iteration is a fresh process. Invisible memory saved at `~/.claude/projects/.../memory/` is by-user, not by-project, and the loops have no special access to it. If knowledge isn't in the repo, the agent re-discovers it every iteration and the user can't see what's accumulating.

## What lives in the repo

| What                                            | Where                       |
| ----------------------------------------------- | --------------------------- |
| Project posture, non-negotiables, pointers      | `CLAUDE.md`                 |
| Operational rules (collaboration, memory, ...)  | `.claude/rules/*.md`        |
| Inter-phase project conventions                 | `.flume/PROTOCOL.md`        |
| Flume chain config (writable paths, gates, ...) | `.flume/chain.ts`           |
| Per-phase prompts                               | `.flume/prompts/*.md`       |
| Active plan + scratch state                     | `.flume/plan/*`             |
| Findings inbox (transient queue)                | `.flume/inbox.md`           |
| Design source of truth                          | `spec/SPEC.md`              |
| Research grounding                              | `spec/RESEARCH.md`          |

The `.flume/plan/open-questions.md` file doubles as cross-tick scratch space — when a build tick learns something the next plan tick should know about (debt observed, surprising pattern, blocker), it writes that there.

## Don't

- Don't write to `~/.claude/projects/.../memory/`.
- Don't read from there expecting context — none should exist; if any does, it's stale.
- Don't fall back to auto-memory "just in case." Add a file under `.claude/rules/`, capture in `spec/SPEC.md` (human-edited), or note in `.flume/plan/open-questions.md` instead.
```

---

## `.claude/rules/spec-plan-build.md`

```markdown
# Spec → Plan → Build

The writing pipeline flows forward. Each layer has one author and one
artifact home. Reaching backward breaks the trust the next layer
depends on.

| Layer | Artifact | Author | Phase | Commit prefix |
| ----- | -------- | ------ | ----- | ------------- |
| spec  | `spec/**` (`SPEC.md`, `WAYPOINT-N.md`, `RESEARCH.md`, `EVAL-*.md`, `archive/`), `.claude/rules/*.md` | human | — | (any) |
| plan  | `.flume/plan/{pending.json,state.md,open-questions.md}`, `.flume/inbox.md` | plan tick (drains inbox) | `plan:` | `plan:` |
| inbox | `.flume/inbox.md` — transient findings queue | external reviewers (`/multidim-review`, `/security-review`, `/grill`, humans) | (any session) | (any) |
| code  | `src/`, `migrations/`, `tests/`, `vitest.config.ts`, `Dockerfile*`, `docker-compose*`, `.claude/skills/*`, `examples/`, `.env.example`, `.gitignore`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json` | build tick | `build:` | `build:` |

Harness commits use `chore(flume):`.

## Directives

- **`spec/` is the human's maintenance surface.** Autonomous flume
  phases (plan, build) never edit it — chain.ts writable-paths is
  the hard boundary. Interactive sessions edit `spec/SPEC.md` (or
  `spec/WAYPOINT-N.md`, `spec/RESEARCH.md`, etc.) *under explicit
  human direction*, with per-edit approval; the human is the
  author, the agent is the editor.
- **WAYPOINT-N.md describes the *thing*, not the *work*.** It names
  the surface being built (architecture, contracts, deferrals); it
  does not enumerate tasks or order of operations. Plan handles task
  breakdown in `pending.json`.
- **pending.json is derived, not authored.** Plan re-derives it every
  tick from SPEC + WAYPOINT + open-questions + inbox + current src.
  Never hand-edit. Cross-tick context belongs in
  `.flume/plan/open-questions.md`.
- **Open questions go in `.flume/plan/open-questions.md`, not in
  pending.json.** If a candidate plan entry can't carry a clean
  `per` cite into SPEC.md, it's a question for a human.
- **`.flume/inbox.md` is a transient queue, not a log.** External
  reviewers append findings; plan drains every tick. Each entry
  leaves the inbox by becoming a pending entry, an open question,
  or an accepted-debt note in the `plan:` commit body. Plan does
  NOT write to inbox — its self-audit findings route directly to
  pending/open-questions, with narrative in the commit body.
- **/grill is the move when open questions accumulate.** The skill
  classifies each decision (spec amendment / scope clarification /
  rule / answered) and routes to the right artifact.
- **Build writes code; plan writes plan artifacts; humans write spec.**
  No layer reaches into another's lane. Cross-cutting fixes get
  filed as plan entries, not patched directly.
- **Pre-1.0 clean-slate posture on spec changes.** Runner is pre-1.0
  pure dev. When a spec change implies a schema or data-shape
  change, **edit the existing migration / source files in place** —
  do not author a new migration to preserve old data, no backfills,
  no backwards-compat shims. The dev database is recreated; that's
  the cost of moving fast. The `migrations/` directory exists to
  define the *current* schema, not its history.

**Why:** the pipeline only works when each layer trusts the upstream
artifact. Build trusts plan trusts spec. If build edits plan
artifacts (or plan edits spec), the agent re-discovers the same
questions every tick and the trust collapses.
```

---

## `.claude/skills/grill/SKILL.md`

```markdown
---
name: grill
description: Interview the user to resolve flume open questions and route each decision to the correct artifact (WAYPOINT, rules, proposed SPEC patches, or just an answer in open-questions.md). Use when WAYPOINT-N §9 has open questions, .flume/plan/open-questions.md has unresolved items, .flume/inbox.md has findings awaiting human input, or pending.json has parked / blockedBy entries.
---

# /grill — resolve open questions, route decisions

Interview the user until each open question has an answer with a place
to live. Walk one branch at a time, resolving dependencies as they
surface. If a question can be answered by exploring the codebase, do
that first. For each question, propose a recommended answer before
asking.

## Read first, then grill

Before the first question, read:

- `spec/WAYPOINT-N.md` (active waypoint) — §9 Open design questions.
- `.flume/plan/open-questions.md` — cross-tick scratch.
- `.flume/inbox.md` — findings awaiting triage (some may need
  human input before plan can route them).
- `.flume/plan/pending.json` — entries with `gate.kind: parked` or
  `blockedBy`. The reason field on a parked entry usually points at
  the question that needs answering.

If WAYPOINT-N.md is missing for the active waypoint, the work itself
is unscoped — grill the scope before any sub-question.

## Per question: classify the decision

Each decision lands in exactly one artifact. Decide which *before*
grilling so you know what you're authoring:

| Decision kind | Lands in | Authored how |
| ------------- | -------- | ------------ |
| Spec amendment (new rule of the system, new section, schema change) | `spec/SPEC.md` | Render the patch in the conversation first, get explicit per-edit approval, then edit `spec/SPEC.md` directly. Human is the author; agent is the editor (per `.claude/rules/spec-plan-build.md`). Never edit SPEC.md without an explicit "go" on the rendered patch. |
| Scope clarification for the active waypoint | `spec/WAYPOINT-N.md` | Edit directly, dialogically, after the user confirms framing. |
| Recurring convention (how agents should behave) | `.claude/rules/<area>.md` (new or existing) | Edit directly; brief declarative directive, not a story. |
| Just answered — no convention, no scope change | Strike from `open-questions.md`; record the decision in this session's commit body. |

If the same question would land in two places, split it into two and
grill them separately.

## During the interview

- One question at a time. Never batch.
- Propose your answer first; let the user accept, reject, or revise.
- Use the codebase as evidence. If `src/cli.ts` validates a field a
  question is asking about, surface that before asking.
- Push back when the user's framing implies a different question than
  the one written down. The point is to converge on the *real*
  question.
- When a decision unlocks a parked or blockedBy pending entry, note
  it in the session — plan reconciles on the next tick.

## Output

One commit per session. Prefix:
- `spec:` if a waypoint or rule changed
- `chore:` if only `open-questions.md` shifted

Body lists each decision with its target artifact. End with a
suggestion to run `pnpm exec flume tick` if anything plan reconciles
against changed (WAYPOINT-N.md, open-questions.md, new rules). Don't
fire flume yourself.

## What this skill never touches

- `.flume/plan/pending.json` — plan derives it from the artifacts you
  edit. Never hand-edit.
- `spec/SPEC.md` without an approved patch in the conversation. SPEC
  is human-authored; the agent edits only after the human has signed
  off on the rendered diff for that specific edit.
- `.flume/plan/state.md` — plan owns it; it's a re-derived view.
- `src/`, `migrations/`, `tests/` — code is build's lane.
```

---

## `.claude-plugin/marketplace.json`

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "runner",
  "description": "Runner — corpus-agnostic knowledge compilation tool. Compile-during-query knowledge for any addressable corpus.",
  "owner": {
    "name": "Centercode"
  },
  "plugins": [
    {
      "name": "runner",
      "source": "./plugins/runner",
      "description": "Compile-during-query knowledge tool for the Runner server. Ships the `runner` skill, `/runner:init` slash command, and `runner` CLI; auth via plugin userConfig.",
      "category": "development",
      "homepage": "https://github.com/Centercode-Inc/runner"
    }
  ]
}
```

---

## `plugins/runner/package.json`

```json
{
  "version": "0.1.0-pre",
  "type": "module"
}
```

---

## `plugins/runner/.claude-plugin/plugin.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "runner",
  "userConfig": {
    "server_url": {
      "type": "string",
      "title": "Runner server URL",
      "description": "Base URL of the Runner server, including scheme (e.g. https://runner.example.com). The /runner:init slash command and `runner` CLI both read this value.",
      "required": true
    },
    "api_token": {
      "type": "string",
      "title": "API token",
      "description": "Long-lived per-(corpus, user) API key issued by `runner admin keygen`. Stored in the OS keychain; never persisted to settings.json.",
      "required": true,
      "sensitive": true
    },
    "default_corpus": {
      "type": "string",
      "title": "Default corpus",
      "description": "Optional. Pre-fills the corpus name in /runner:init when binding a fresh cwd. Leave blank to be prompted each time."
    }
  }
}
```

---

## `plugins/runner/commands/init.md`

```markdown
---
description: Bind this cwd to a Runner corpus by writing .runner/config.json and validating against /status.
argument-hint: [--corpus <name>] [--force] [--dry-run]
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# /runner:init — bind this cwd to a Runner corpus

Writes a thin `.runner/config.json` in the current working directory so
the `runner` CLI and skill can discover the corpus from any subdir.
Server URL and API token come from plugin userConfig — they are **not**
written to the file. Before writing, the command hits `/status` so a
wrong key or wrong server fails here, not on the first emit.

## Inputs

Arguments — `$ARGUMENTS`:

- `--corpus <name>` — bind to `<name>`, skip the prompt
- `--force` — overwrite an existing `.runner/config.json`
- `--dry-run` — report what would happen; do not write, do not contact the server

Plugin userConfig (interpolated below):

- Server URL: `${user_config.server_url}`
- API token: `${user_config.api_token}` — secret; never echo, never commit
- Default corpus (optional): `${user_config.default_corpus}`

## Steps — run these in order

1. **Parse `$ARGUMENTS`.** Extract `--corpus <name>`, `--force`, `--dry-run`.
   Reject unknown flags with `Unknown flag '<flag>'. Valid: --corpus <name>, --force, --dry-run.` and stop.

2. **Confirm userConfig is present.**
   - If `${user_config.server_url}` is empty: stop with `Runner server_url is not configured. Re-run /plugin install to set userConfig.`
   - If `${user_config.api_token}` is empty: stop with `Runner api_token is not configured. Re-run /plugin install to set userConfig.`

3. **Resolve the corpus name.**
   - If `--corpus <name>` was passed and non-empty, use it.
   - Else if `${user_config.default_corpus}` is non-empty, use it.
   - Else use `AskUserQuestion` to prompt the user for a corpus name. If they decline or supply an empty value, stop with `Corpus name required.`

4. **Check for an existing `.runner/config.json` in the cwd.** Use `Read` on `./.runner/config.json`.
   - If it doesn't exist, proceed.
   - If it exists and `--force` was **not** passed, stop with `.runner/config.json already exists at ./.runner/config.json. Re-run with --force to overwrite, or remove it first.`
   - If it exists and `--force` **was** passed, note that it will be overwritten after `/status` validation succeeds.

5. **Validate against `/status`.** Skip this step **only** if `--dry-run` was passed.

   Strip any trailing `/` from `${user_config.server_url}` to build the target URL. Pass the token through an environment variable so it never appears in `argv` / process listings:

   ```bash
   RUNNER_API_TOKEN='${user_config.api_token}' \
     curl --silent --show-error --fail-with-body --max-time 10 \
          -H "Authorization: Bearer $RUNNER_API_TOKEN" \
          '<server_url-without-trailing-slash>/status'
   ```

   Interpret the result:
   - **Network failure** (DNS, connection refused, timeout): stop with `Could not reach <server_url>: <curl error>. Check the server URL in plugin userConfig.` Do **not** write `.runner/config.json`.
   - **HTTP 401 / 403**: stop with `Server rejected api_token (HTTP <code>). Check the token in plugin userConfig.` Do **not** write `.runner/config.json`.
   - **HTTP 5xx** or other non-2xx: stop with `Server error at /status (HTTP <code>): <body>. URL may be correct but server is unhealthy.` Do **not** write `.runner/config.json`.
   - **2xx**: parse the JSON body. It carries `{ ok, corpus, stats: { propositions, entities, last_compile_at }, lenses: [{name, directive?}, ...] }`. Keep the parsed object — you'll echo a summary in step 7.

6. **Write `.runner/config.json`.** Skip this step if `--dry-run` was passed.

   Per WAYPOINT-1 §5 + SPEC §12, the file schema is `{ corpus (required), server (optional, literal), apiKey (optional, literal or env:NAME) }`. `/runner:init` writes **only** the `corpus` field; `server` and `apiKey` are operator-edit territory (e.g. a tier-2 CI repo committing a per-corpus server URL with `apiKey: "env:RUNNER_API_KEY"`). At runtime the CLI resolves server/apiKey per-field, first non-empty wins: `RUNNER_*` env > file slot > `CLAUDE_PLUGIN_OPTION_*` (set by plugin userConfig). The init path leans on the plugin-env tier, which keeps the secret in the Claude Code keychain:

   ```json
   {
     "corpus": "<resolved-name>"
   }
   ```

   Two-space indentation, trailing newline, no comments. If `./.runner/` does not exist, create it first (`mkdir -p ./.runner`). Then use `Write` on the path `./.runner/config.json`.

7. **Report success.** Print a short, human summary:
   - Corpus name bound
   - Absolute path of the `.runner/config.json` written (or `dry-run: no file written`)
   - Server URL that was validated (or `dry-run: server not contacted`)
   - `corpus` echoed by `/status` (server-side corpus name, distinct from the cwd binding)
   - `lenses[]` from `/status` — list each `name`; flag entries that carry a `directive`
   - Proposition + entity counts from `stats` (a useful "is this corpus already populated" signal)

## What this command does NOT do

- It does not write `server` or `apiKey` into `.runner/config.json`. The schema permits them (SPEC §12) but they are operator-edit territory; the init path relies on plugin userConfig (`CLAUDE_PLUGIN_OPTION_*`) at runtime.
- It does not modify server-side state. `/status` is the only HTTP call, and it is a `GET`.
- It does not validate the corpus name against the server. Waypoint 1 is one server, one corpus — the name in `.runner/config.json` is a label for the cwd binding, not a key the server resolves.
- It does not issue or rotate API keys. Use `runner admin keygen` (server-side, admin scope) for that.
```

---

## `plugins/runner/hooks/hooks.json`

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/attest-read.mjs\""
          }
        ]
      }
    ]
  }
}
```

---

## `plugins/runner/hooks/attest-read.mjs`

```javascript
#!/usr/bin/env node
// SPEC §14 / WAYPOINT-3 §5 — PostToolUse hook on `Read`. Hashes the
// bytes Claude Code's Read tool returned and POSTs the triple
// (session_id, source_uri, source_content_hash) to /attest so the
// server can later cite-validate /emit. Sync; the agent waits.
//
// Session-id contract: the Claude Code session_id from the hook input
// IS the compile_session_id (WAYPOINT-3 §7 path b — one-session-one-
// compile for v0.1.0). The skill teaches the agent to reuse the same
// id when /emit'ing so cite-validation lines up.
//
// Auth: bearer from RUNNER_API_KEY (or the plugin userConfig fallback
// CLAUDE_PLUGIN_OPTION_API_TOKEN). Server base from RUNNER_SERVER (or
// CLAUDE_PLUGIN_OPTION_SERVER_URL). Mirrors the CLI's precedence so
// one .runner/config.json or one plugin install configures both.
//
// Failure mode: exit 2 + stderr on any error reachable to the agent.
// The agent sees the stderr (Claude Code surfaces hook exit 2) and
// can re-Read to retry the attestation. Silent failure was the
// alternative; it preserved agent UX but would have masked a broken
// citation chain until /emit rejected the cite later, far from the
// cause.

import { createHash } from 'node:crypto';

const PROGRAM = 'runner-attest';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function fail(message) {
  process.stderr.write(`${PROGRAM}: ${message}\n`);
  process.exit(2);
}

function joinUrl(server, path) {
  return `${server.replace(/\/+$/, '')}${path}`;
}

function pickEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    // No stdin payload at all — nothing to attest. The matcher should
    // prevent this in practice; treat as a no-op rather than a hard
    // fail so a mis-wired test invocation doesn't break the agent.
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    fail(`invalid hook input JSON: ${err.message ?? err}`);
  }

  // Defense in depth: matcher is "Read" but a future shared hooks.json
  // could fan us out. Skip silently for other tools.
  if (input?.tool_name !== 'Read') return;

  const sessionId = input.session_id;
  const filePath = input?.tool_input?.file_path;
  const file = input?.tool_response?.file;
  const content = file?.content;

  // Image/binary Read responses lack a string `content`; the agent has
  // no bytes to cite, so there is nothing to attest. Skip silently.
  if (
    typeof sessionId !== 'string' ||
    typeof filePath !== 'string' ||
    typeof content !== 'string'
  ) {
    return;
  }

  const server = pickEnv('RUNNER_SERVER', 'CLAUDE_PLUGIN_OPTION_SERVER_URL');
  const apiKey = pickEnv('RUNNER_API_KEY', 'CLAUDE_PLUGIN_OPTION_API_TOKEN');
  if (!server) {
    fail(
      'missing server URL (set RUNNER_SERVER, or install the runner plugin so CLAUDE_PLUGIN_OPTION_SERVER_URL is set)',
    );
  }
  if (!apiKey) {
    fail(
      'missing API key (set RUNNER_API_KEY, or install the runner plugin so CLAUDE_PLUGIN_OPTION_API_TOKEN is set)',
    );
  }

  const sourceContentHash = createHash('sha256')
    .update(content, 'utf8')
    .digest('hex');

  const body = {
    session_id: sessionId,
    source_uri: `file://${filePath}`,
    source_content_hash: sourceContentHash,
  };
  if (Number.isInteger(file.startLine)) body.start_line = file.startLine;
  if (Number.isInteger(file.numLines)) body.num_lines = file.numLines;
  if (Number.isInteger(file.totalLines)) body.total_lines = file.totalLines;

  const url = joinUrl(server, '/attest');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`POST ${url} failed: ${err?.message ?? err}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      // body unreadable; status is enough signal
    }
    fail(
      `POST ${url} → ${res.status} ${res.statusText || ''}${
        detail ? `; ${detail}` : ''
      }`,
    );
  }
}

main().catch((err) => {
  fail(`unexpected error: ${err?.stack ?? err?.message ?? err}`);
});
```

---

## `plugins/runner/skills/runner/SKILL.md`

```markdown
---
name: runner
description: First-line skill for any structural, behavioral, or knowledge question about the corpus. Reach before Grep, Explore, or Read on prompts like 'how does X work', 'why does X happen', 'what edge cases…', 'walk me through X', 'who calls/consumes X', 'where is X defined', 'what's known about X', and compile-shaped prompts like 'compile knowledge about Y', 'save/remember/distill what you learned'. Runner is a compile-as-you-answer loop — `runner search` for existing propositions → read source for gaps → distill atomic, lens-tagged claims → `runner emit` BEFORE answering → answer with citations. Local structural indexers (LSP, ctags, language graph tools) are runner's Step 2 read tier, not competing first-line skills. Grep, Explore, Read fill gaps inside Step 2; they don't replace the loop. Stale-flagged propositions are cues to re-read the drifted source and emit a new claim, not signals to discard.
allowed-tools: Bash, Read, Grep, Glob
---

# Runner — compile knowledge while you answer

Runner stores **propositions** — atomic, audience-tagged claims about
what the corpus DOES, WHY, and FOR WHOM, anchored to named entities and
citable back to the URIs they came from. The server doesn't know your
codebase. *You* read it. The server holds what you've already learned
so the next agent doesn't re-derive it.

**Compile is primary; your response is downstream.** Every turn that
touches the corpus runs the loop. Even on a warm graph where existing
propositions look sufficient, read at least one source — re-derivation
refreshes proposition source attestations at the current frame hashes
and the server's content-hash dedup absorbs the cost of known claims
silently.

**The loop:**

```
search   → ranked propositions about the topic
read     → source for gaps the props don't cover
distill  → atomic intent claims from what you read
emit     → those claims back to the server (before answering)
answer   → the user, grounded in what you found + what you wrote
```

The same loop runs whether the user asked a question or asked you to
"compile knowledge about X". You do not switch modes. Compile is
incidental to the answer.

---

## When to invoke

**Query-shaped prompts.** "How does authentication work?" "Why would a
user see a 403 here?" "What edge cases does this flow handle?" "Who
reads from the audit log?" Anything that asks the corpus to explain
itself.

**Compile-shaped prompts.** "Compile knowledge about the billing flow."
"Save what you learned about retries." "Remember that the session
timeout is 30 minutes." Anything that asks you to capture or distill
knowledge for the next agent.

**Drift signals.** When prior props come back tagged `freshness: stale`,
the user implicitly wants the proposition reconciled with what the
source says now — re-read and re-emit even if the question is "narrow."

If the cwd has a `.runner/config.json` and `runner status` succeeds,
you are bound to a corpus. If either is absent, fall back to plain
reading and tell the user the skill is unbound for this cwd.

---

## Session start — fetch /status once

Run `runner status` (or `GET /status`) once per session. The `lenses`
array carries two things you will use later: the closed vocabulary of
valid lens names (emitting an unconfigured lens hard-fails 400) and,
per lens, an optional `directive` — free-text extraction instruction
shaping what content belongs under that audience.

```json
"lenses": [
  { "name": "external",
    "directive": "Extract user-facing behavior, business rules, configuration effects, and error conditions. Exclude code structure, internal class/function names, file paths, implementation algorithms, database identifiers, and internal return codes." },
  { "name": "internal" }
]
```

Capture the `{ name → directive? }` map; you will apply it at Step 4
when distilling under each lens. A bare-string lens (one with no
`directive` field) gives you the name alone; fall back to inferring
audience semantics from the name — works for interpretable names
("internal", "support"), degrades for opaque ones. The deployment's
project context (CLAUDE.md, co-loaded plugins, per-corpus skill
overlays) may further constrain meaning.

---

## Step 1 — Search

**Entry point is `mode: entity`, the default.** The server embeds the
query, takes the top-K nearest entities by cosine, and returns
propositions about them ranked by RRF across that neighborhood. You
get a small, high-precision result set with the entity neighborhood
already implicit.

```bash
runner search "<query>" --lens <name> --limit 20
```

**Walk the graph from named entities you discover.** Every returned
prop names ≥1 entity. When the results surface a name you hadn't
queried for, ask the server for everything it knows about that
entity directly — no embedding, no rerank, just everything `about`
that name:

```bash
runner search "" --entity <Name> --lens <name>
```

A few hops of this maps the neighborhood the question lives in. Stop
when the marginal hop returns nothing new.

**Use `mode: fts` only when entity match misses.** Lexical search on
proposition text is the fallback for queries whose key terms aren't
entity names ("idempotent", "race condition", "rollback path"). FTS
requires a `query`; there's no filter-only fallback in this mode.

```bash
runner search "<phrase>" --mode fts --lens <name>
```

**Filter aggressively.** `--lens` cuts noise from audiences you aren't
serving. `--source <uri>` narrows to props citing a specific file.
`--limit` keeps response size bounded.

**What you do NOT do here.** Don't grep or read files yet. The cheap
move is to ask the server what it already knows. If existing props
fully cover the question — and the compile-primary rule's "read ≥1
source" still applies — you'll still read once to refresh attestations,
but the read is targeted by what /search returned.

---

## Step 2 — Decompose adaptively, after exploration

Do not pre-decompose the query into facets. The initial /search teaches
you the corpus shape for this question; judge from there whether the
work is single-focus or multi-angle, and whether the topic is dense
enough that one more hop is worth it.

Whatever boundary you reach when you stop is yours to choose; if it
matters to the user, surface that boundary in your response (the
skill suggests; you decide format).

---

## Step 3 — Read source for gaps

After search. Identify what the props don't cover:

- A claim implied by the question but absent from any returned prop
- A returned prop tagged `freshness: stale` — re-read the URIs named
  in `freshness_detail.drifted_sources`
- A returned prop that's correct but missing a dimension the user
  cares about (success path covered but the question is about errors)

Read with your environment's tools. When a local structural indexer
(LSP, ctags, language-specific graph tool) is available, prefer
structural navigation over grep for "where is X defined / who calls
Y" questions — deterministic beats heuristic. If no indexer is
available, just grep; runner is corpus-agnostic and the structural
tier is optional. *Which* indexer is on PATH and how to invoke it is
corpus-specific; the runner skill stays silent on tool names. Your
project's CLAUDE.md or a co-loaded plugin tells you.

**Track which files you actually read.** You will cite every one of
them on the propositions you emit. Hash each file you read (sha256 of
the bytes you saw); the hash is the freshness anchor.

**Read attestation is harness-side; `Read` is the primitive for
citable sources.** The runner plugin ships a PostToolUse hook on
`Read` that POSTs an entry to `/attest` after every read. The server
records `(session_id, source_uri, source_content_hash)` in the
session's attestation manifest, and `/emit` validates every prop's
`sources[i]` against that manifest — citations to a `(uri,
content_hash)` the session never read via `Read` are rejected with
`code: "unattested"`. Other read paths (Bash `cat`, Grep with
`output_mode: content`, WebFetch) do not attest; if you captured a
citable source through one of those, re-`Read` the file before emit
so the hook witnesses it. You never call `/attest` yourself — the
hook handles it. Your only obligation is choosing `Read` as the
primitive for any source you intend to cite.

---

## Step 4 — Choose the lens, apply its directive; multi-lens emit

A **lens** tags the audience of the proposition — who retrieves it
later. Tag every emitted prop with exactly one lens, drawn from the
set you read at session start.

**Apply the directive at distillation, not after.** When you emit
under `lens: X`, shape each claim's content to match X's `directive`
(the extraction instruction you captured at session start). The
directive states what to include and what to exclude for that
audience — fold it into the prose as you distill, not as a post-hoc
filter. The server does not validate audience-fit on /emit; the
directive is your discipline.

When a lens has no directive (bare-string config), infer audience
semantics from the name. Interpretable names ("internal", "support")
guide reasonably; opaque names degrade — when in doubt, ask the user
what the lens should include before emitting under it.

**Multi-lens emit from a single source read.** One source read can
yield intent claims for multiple audiences. Emit each claim tagged
with the lens that fits the *claim's* content, not the lens that
fits the query, and shape each claim by its lens's directive. A
function whose behavior is externally visible can ground both an
engineering-audience prop and a user-audience prop from the same
read — each shaped to its own audience. Dedup absorbs misfires
silently.

When you genuinely can't pick a lens, the question's verbs decide.
"How is X implemented" leans engineering. "What does the user see"
leans user-facing. "What guarantees X" leans verification. Whatever
audience labels your corpus declares, the mapping is the same — but
once you've picked, the directive shapes the content.

---

## Step 5 — Distill atomic intent claims

**Before composing your `runner emit` payload, read
`references/emit-discipline.md`.** That file delivers the atomicity,
intent-vs-structure, naming, and citation rules fresh into your
context at the moment you need them — the discipline doesn't stale
between session start and emit time, because you re-read it right
before each emit.

Headline rules (full detail and the WRONG/RIGHT example in
`references/emit-discipline.md`):

- **A prop is a relaxed triple.** One claim plus an entity-set;
  the entity-set carries the relationship structure (graph edges
  from shared entity references). Don't emit "X uses Y" — emit a
  claim whose entities are `[X, Y]` and let the edge set carry it.
- **Intent only, not structure.** Structural facts an indexer
  surfaces — "X calls Y", file/line locations, signatures,
  namespace placement, AST-derivable control flow — are off-limits.
  Runner emits the WHY / BEHAVIOR / CONTRACT / TRADE-OFFS /
  FAILURE-MODES layer above structural. **Intent is sparser than
  structure**: a 0-emit outcome on a query-relevant file is correct
  when the file is plumbing the AST already shows.
- **Independence test.** Could either half of this prop be false
  while the other stays true? If yes, split. The validator's
  `non_atomic` warning is a soft nudge, not a judge; the discipline
  is yours.
- **Entity reuse > entity creation.** Hubs (5+ props per entity)
  beat fragments. Reuse names verbatim. Source-canonical casing for
  symbols; short noun-phrase for semantic concepts.
- **Self-contained, citable, lens-tagged.** No anaphora. Every prop
  cites ≥1 source URI + content hash. Each prop carries exactly one
  lens, drawn from `/status`'s configured set, shaped by the lens's
  directive.

Re-read `references/emit-discipline.md` whenever the headline rules
above feel abstract or you're about to emit a compound claim.

---

## Step 6 — Emit (before answering); review what you produced

Pipe a payload to `runner emit`:

```json
{
  "propositions": [
    {
      "content": "A user signs in with email or username; when an email is provided, the system resolves to the canonical username and retries.",
      "entities": [
        { "name": "Authentication" },
        { "name": "Login" }
      ],
      "sources": [
        { "uri": "file://src/auth/login.html", "content_hash": "abc123..." }
      ],
      "lens": "external",
      "conflicts_with": []
    }
  ],
  "compile_session_id": "<uuid you generate per compile>"
}
```

```bash
echo "$payload" | runner emit
```

**Emit before answering.** New props are what makes the *next* agent's
job cheap. If you answer first and emit afterward, you risk emitting a
sloppier version of what you would have written into the answer. Emit,
then summarize.

**Conflict marking — declare disagreement at the moment you have full
context.** When a /search returned an existing prop and your source
read produces a claim that disagrees with it, emit the new claim with
`conflicts_with: [<existing_prop_id>]`. That marks the edge in the
graph so future readers see the disagreement surfaced via /search.
Don't emit silently over an existing claim; the agent who returns to
this entity later needs the link.

**Maintainer review — read the response.** /emit returns per accepted
proposition an `entities` array with `{ name, created }` per entity:
`created: true` when this emit inserted a new entity row, `false`
when it linked to an existing row by exact-name match.

```json
{
  "accepted": [
    {
      "id": "...",
      "content_hash": "...",
      "deduped": false,
      "entities": [
        { "name": "Authentication", "created": false },
        { "name": "Login", "created": true }
      ],
      "warnings": []
    }
  ]
}
```

Scan the `created: true` names. If one of them looks suspiciously close
to a name you saw in /search results — different casing, a slightly
different noun form, a plural where the existing entity was singular —
you likely fragmented the graph. The server doesn't reject; this is a
maintainer signal for you to surface to the user (your discretion).

**Hard-rejected (400).** Missing `content`, `entities[]`, `sources[]`,
or `lens`. Unknown lens for this corpus. `conflicts_with` UUID that's
self-referential, points at another prop in the same batch, or doesn't
exist. Read the structured `errors[]` and fix.

**Warnings (returned with 201; do not block persistence).** Suspected
anaphora, suspected non-atomic shape. Read them, fix the underlying
writing, re-emit — they're feedback for the *next* compile.

---

## Step 7 — Read conflicts and freshness, then reason

**Conflict edges on /search results.** Each returned prop carries a
`conflicts: [<uuid>, ...]` array — UUIDs of other propositions known
to disagree with it, frame-filtered (only edges where both endpoints
are fresh in your frame; stale-in-frame edges are hidden). When a
conflict is present, compare the conflicting props' source
attestations:

- **Shared URI+hash** (the disagreement attests from the same frame of
  the same file) → this is a **correction**. The newer claim
  supersedes; prefer the more recent `created_at`. Surface only the
  current view unless the user is specifically asking about history.
- **Disjoint sources, or same URI at different hashes** → this is
  **genuine corpus disagreement**. Both claims are valid in their
  respective frames; surface the disagreement to the user (your
  discretion on format).

The distinction lives here in skill prose; the schema records the
edge without a `kind` column.

**Freshness signals inform reasoning, not display.**

Every search response decorates each prop with `freshness: 'fresh' |
'stale'`. Stale does **not** mean wrong, and stale props are **not**
filtered out — the server hands them back flagged so you can decide.

When a prop is stale, treat it as a cue to re-read the drifted source
named in `freshness_detail.drifted_sources[]`. Then:

- **Claim still holds.** The drift was incidental. Emit nothing new;
  the prop stays useful.
- **Claim was about behavior the file change doesn't affect.** Same —
  audience-translated lens content especially survives structural
  churn.
- **Claim is now wrong.** Distill a new proposition stating the current
  behavior and emit it with `conflicts_with: [<old_prop_id>]`. Both
  persist; the edge marks the supersession.

Whether you communicate freshness in your response is your choice.
Stale ≠ display-this-warning. Freshness is best-effort — URIs the
caller has no current hash for read `fresh` by default, since the
posture is no-negative-signal.

---

## Termination — citability, not phrasing

Stop compiling when you could ground a response with citations to
specific propositions (retrieved or just-emitted), not when you have
phrased a response. **Citable ≠ cited** — the skill ensures you have
the props you'd need; you decide whether and how to surface citations
in the response.

The bound is best-effort and agent-judged. Calibrate scope and depth
from the signals you read:

- query complexity (single-focus vs multi-angle)
- retrieval density (how warm is the graph for this topic)
- apparent cost of further reading (file size, depth of indirection)
- diminishing returns (each hop adds little, props start to repeat)

No file counts, no token budgets, no cycle limits — those numbers
don't generalize across corpora.

---

## Quick reference

**Bash invocations:**

```bash
runner status                                    # corpus health + lens set
runner search "<query>" --lens <name>            # entity-mode default
runner search "" --entity <Name> --lens <name>   # graph walk
runner search "<phrase>" --mode fts --lens <name># FTS fallback
echo "$json" | runner emit                       # stdin JSON
```

Every command honors `--cwd <path>` to override `.runner/config.json`
discovery and `--json` to force compact JSON for piping.

**The contract in one paragraph.** Every proposition is one atomic
intent claim, self-contained (no anaphora), anchored to ≥1 entity
name, cited to ≥1 source URI + content hash, and tagged with one of
the corpus's configured lenses. Structural detail stays in the
reader's environment, not in /emit. The server dedups by exact
content hash, decorates retrieval with per-source freshness and
conflict edges (both frame-filtered), and records — but does not
resolve — disagreement.

**The loop in one paragraph.** On any prompt that touches the corpus,
ask the server first (`runner search` in entity mode, walk by entity
into the neighborhood). Read source for gaps and for stale-flagged
props whose drift matters; read at least once even on warm graphs to
refresh attestations. Distill atomic intent claims, lens them per
audience (multi-lens from one read when both fit), name entities by
the canonical names you saw in /search, mark known disagreements with
`conflicts_with`, and `runner emit` before answering. Review the
emit's `entities[].created` flags for fragmentation. Answer the user
from props + reading + emissions; surface freshness and conflict only
when it serves the response. The next agent's search will return
what you wrote.

---

## What this skill stays silent on

- **Response composition.** Whether/how to cite, paragraph structure,
  inclusion of lens spread, audience-shaping prose — all your
  territory. Runner ends at /emit.
- **Corpus-specific tool names.** Which indexer is on PATH, which
  canonical entity names this corpus uses, which lens names mean
  what — your project context provides. The skill names the pattern.
- **Hardcoded effort bounds.** No file counts, no token budgets, no
  cycle limits. You calibrate per corpus from the signals above.
```

---

## `plugins/runner/skills/runner/references/emit-discipline.md`

```markdown
# Emit discipline

This file is loaded just-in-time, **right before you compose your
`runner emit` payload**. The rules below are load-bearing for the
retrievability and structural integrity of the graph; the
validator's gentle warnings do not enforce them — your distillation
does.

## The model — a prop is a relaxed triple

A proposition is **one claim plus an entity-set**, where the
entity-set carries the relationship structure of the graph (edges
formed from shared entity references across props). A prop with
`entities: [Login, JwtService]` and content "Login validates
sessions via JwtService tokens" structurally encodes the edge
`<Login, validates-via, JwtService>` — the graph picks up the
relationship from the shared entities. You **don't** emit a separate
"X uses Y" claim because the graph reads that off the shared entity
set.

The model's payoff: dedup, conflict-edge marking, and per-fact
retrieval all work on each claim independently. Compound props
collapse all of that into one row that none of those patterns
retrieve cleanly. **The more atomic the claim, the more scalable
the graph.**

---

## Intent, not structure

The structural tier — what an indexer in the reader's environment
(LSP, ctags, language-specific graph tool) can answer at read-time
— is **off-limits to /emit**:

- "X calls Y" / "X is called by Y"
- "X is defined in file F at line L"
- "X has signature `(A, B) → C`"
- "X is in namespace/module N"
- Parameter lists, method tallies, property tallies, type hierarchies
- AST-derivable control flow ("first calls X, then calls Y, returns Z")
- Constant-value listings (`X = 5`)

All of that is the indexer's tier. A reader who needs structural
detail resolves it from their own indexer using the entity name and
source URI you cite. Don't duplicate the AST in /emit.

Runner emits the **layer above structural** — claims an indexer
alone can't reach:

- **WHY** the code is shaped this way — the problem the structure
  solves, the design intent
- **BEHAVIOR** that emerges across calls or pieces of state — the
  cross-call invariant, the user-visible effect that isn't local to
  any single function
- **CONTRACT** between callers and callees — preconditions,
  postconditions, who's responsible for handling each failure
- **TRADE-OFFS** the code embodies — why this approach vs. the
  obvious alternative
- **FAILURE MODES** the code handles, mishandles, or pointedly
  doesn't

### Stopping rule

When you find yourself describing the code's mechanics — what method
calls what, what parameters flow where — step back and ask:

> *What does this code DO that someone reading the symbol table
> can't already see?*

If the honest answer is "nothing — it's plumbing the AST already
shows", **don't emit.**

### Intent is sparser than structure

Not every file you read has intent worth capturing. **A 0-emit
outcome on a query-relevant file is correct** when the file is
genuinely just plumbing. Don't fill the gap with structural
restatement. The "I must emit something because I read this file"
reflex is what produces the structural-duplication failure mode.

---

## Atomicity

A proposition is **one claim**. Apply the **independence test**:

> Could either half of this prop be false while the other stays true?

If yes, you have two claims fused into one. Split them. Each split
prop will be retrieved by a different question, dedup against a
different `content_hash`, and share entities with different
neighbors in the graph.

### Three failure modes, decreasing severity

1. **Enumerations that duplicate graph structure.** *Actively
   damaging.* "The five Hangfire queues are under_30s, under_5m,
   under_1h, under_1d, and default" restates structure the edge set
   already carries — emit each queue as its own prop sharing the
   `JobQueue` entity, and the "these are queues" relationship lives
   in the edge set automatically, plus each fact is independently
   retrievable.
2. **Conjunctions of independent topics.** *Should split.* "JobQueue
   defines queue constants and `ServicesConfiguration` registers
   worker pools" fuses two unrelated facts about different subjects.
   Splits cleanly; cost is zero.
3. **Single-subject multi-fact compounds.** *Tolerable residual.*
   "JwtService validates RS256 tokens and falls through to anonymous
   on failure" — two facts about one subject, each defeasible
   independently but doesn't damage graph structure. Prefer split
   when easy; don't agonize.

### Legitimate compounds (narrow set)

A few shapes survive splitting because the halves lose meaning in
isolation:

- *Action-with-mechanism* — "Login validates credentials by calling
  `usp_Login` first". The mechanism is how the action is performed,
  not a separate claim.
- *Relationship-via-intermediary* — "AuthMiddleware delegates session
  validation to JwtService via the Authorization header". One
  relationship, not three.

If you can't articulate why splitting destroys meaning, the compound
shouldn't survive.

---

## WRONG / RIGHT — the highest-leverage pattern

WRONG (enumeration restates what the edge set already carries; also
structural-only — describes the AST):

```json
{
  "content": "Connect defines five Hangfire queues — under_30s, under_5m, under_1h, under_1d, and default — each with its own SLO and worker pool.",
  "entities": [{ "name": "JobQueue" }, { "name": "Hangfire" }]
}
```

RIGHT (intent-bearing, atomic; each fact is its own prop; the shared
`JobQueue` entity is the edge set):

```json
{
  "content": "JobQueue partitions Hangfire work into SLO-bounded lanes so slow jobs don't block fast jobs.",
  "entities": [{ "name": "JobQueue" }, { "name": "Hangfire" }]
}
{
  "content": "JobQueue.ThirtySecondsOrLess carries a 30-second total-service SLO covering queue latency plus performance duration.",
  "entities": [{ "name": "JobQueue" }]
}
... (one prop per queue, each tying back to JobQueue)
```

The WRONG version has one `content_hash` and two entity edges. The
RIGHT version has separate `content_hash`es per fact, more entity
edges, and each prop answers a different question independently.
Crucially: the RIGHT version is *intent-bearing* — it names what the
design DOES ("partitions work into SLO-bounded lanes so slow jobs
don't block fast jobs"). The WRONG version is *structural-only* —
cartograph or any AST walker could generate that from the symbol
table.

---

## Self-contained

No `this`, `that`, `it`, `these`, `those`, `the previous`. Every
prop will be retrieved out of context, possibly years from now. If
the prop reads "this window is sliding, not fixed", nobody
downstream knows what window. Resolve the referent inline.

---

## Anchored to entity names — aim for hubs

Every prop names ≥1 entity (`entities[]`, each with `name`). The
entity set IS the relationship structure of the graph — sharing an
entity across props is what makes the graph navigable.

### Hubs, not fragments

An entity that ends up with one prop attached is a **fragment**;
an entity with five or more is a **hub** worth navigating to. The
fastest way to grow hubs is **reuse existing entity names verbatim**
rather than coining variants. This applies whether the entity came
back from `/search`, was named in a prior prop you read, or appears
in the source you're reading. Same spelling, same casing.

### Naming discipline

When you must introduce a new entity name:

- **Source-canonical symbols** (classes, functions, identifiers that
  appear verbatim in source) — preserve casing and punctuation as
  they appear in source. That's the name the reader's indexer will
  resolve against.
- **Semantic concepts** (audience-relevant ideas that aren't a
  single source identifier) — use a short noun-phrase form:
  `Authentication`, not "the authentication system"; `LoginFlow`,
  not "the flow a user takes when logging in".

### Maintainer review

After `/emit` returns, scan the `accepted[i].entities[].created`
flags. `created: true` means a new entity row was inserted; `false`
means the name matched an existing entity. If a `created: true`
name looks suspiciously close to a name you saw in `/search`
results — different casing, a slightly different noun form, a
plural where the existing entity was singular — you've likely
fragmented the graph. The server doesn't reject; this is your
maintainer signal to surface to the user (your discretion on
format).

---

## Citable

Every prop names ≥1 source (`sources[]`, each with `uri` +
`content_hash`). The URI is what you read (typically `file://...`);
the hash is the sha256 of the bytes you saw. The pair is how
freshness gets computed later.

**Citations are gated on harness-witnessed reads.** The runner
plugin's PostToolUse hook on `Read` POSTs each read to `/attest`.
`/emit` validates every `sources[i]` against the session's
attestation manifest and rejects any `(uri, content_hash)` triple
the session never read via `Read` with `400 code: "unattested"`. If
you captured a source through Bash (`cat`, `head`, `tail`), Grep
with `output_mode: content`, or WebFetch and want to cite it,
**re-`Read` the file first** so the hook posts an attestation; only
then is the cite emittable. You never call `/attest` yourself — the
hook handles it.

**A proposition with no concrete source is a hallucination; refuse
to emit it.**

---

## Lens-tagged

Exactly one lens per prop, drawn from the configured set you read
at session start (`runner status` returns `lenses[]` with optional
per-lens `directive` text). The directive tells you the content
shape that audience expects — apply it during distillation, not as
a post-hoc tag. If a lens has no directive on file, infer audience
semantics from the lens name (less reliable; works for
interpretable names, degrades for opaque ones).

---

## Conflict marking

When the search you did at the start of this loop returned a prop
you now disagree with after reading source, emit the new claim with
`conflicts_with: [<existing_prop_id>]`. This is the moment you have
full context — the existing prop's content, the source you just
read, the disagreement between them. Server records the edge;
future `/search` calls surface it (frame-filtered).

Don't emit silently over an existing claim. The conflict edge is
what makes the disagreement visible to the next agent.

---

## Pre-emit checklist

Before piping your payload to `runner emit`, walk this list once:

- **Each prop is one claim** — independence test passes.
- **Each claim is intent, not structure** — describes WHY/BEHAVIOR/
  CONTRACT/TRADE-OFFS/FAILURE; not "X calls Y" / signatures /
  control flow.
- **Each prop is self-contained** — no anaphoric pronouns.
- **Entity names are reused verbatim** where the entity already
  exists in the graph.
- **Source URIs and content hashes** are concrete and the bytes were
  seen through `Read` (not Bash `cat` / Grep `output_mode: content`
  / WebFetch) — `/emit` rejects unattested citations with `code:
  "unattested"`. Re-`Read` first if needed.
- **Lens matches the claim's content** per the directive returned
  from `/status`.
- **Conflicts declared** for any prop you're emitting that disagrees
  with an existing /search result.

If a prop fails any of these, fix it before emit. Re-emitting after
the fact still works (dedup absorbs the duplicate), but each
miss-then-fix costs a roundtrip and pollutes the freshness
attestation history.
```

---

## `.flume/PROTOCOL.md`

```markdown
# Flume Protocol — project conventions

Runtime mechanics (baton, gates, handoff, pending schema) live in `.flume/chain.ts` and the installed `flume` pnpm dep. This file holds project-side conventions the chain config doesn't encode.

## The chain

`spec/SPEC.md` → `.flume/plan/` → `src/` → git log

SPEC.md is human-curated source of truth. Plan derives the work breakdown against it; build executes one entry at a time. Plan is advisory to build (build re-validates against the cited SPEC section before acting).

| Layer | Author | Phase | Commit prefix |
| ----- | ------ | ----- | ------------- |
| spec  | human  | —     | (any)         |
| plan  | plan   | plan  | `plan:`       |
| code  | build  | build | `build:`      |

The commit body says what kind of work the tick did. Typically a sentence on the why.

Harness-authored commits use `chore(flume):` (e.g. `chore(flume): ship TAG`).

## Disk vs git log

When asking "did X ship?" or "is gate Y satisfied?" — read the disk artifact (`.flume/plan/pending.json`, the source file). Never grep commit messages or `git log`. Git log is orientation, not authority.

## Push policy

- Build pushes per commit to `main` after green validation (the chain config's gates are the bar).
- Plan commits don't push; they ride the next build push.
- Never force-push, amend pushed commits, or `--no-verify`.

## Where runtime lives

- Inter-phase contracts (baton, gates, writable paths, handoff): `.flume/chain.ts` (this repo).
- Flume runtime (pending schema, dispatcher, fanout, worktree setup, cherry-pick): installed as the `flume` pnpm dep from `Jwcjwc12/flume` at `node_modules/flume/`.
- Per-phase prompts: `.flume/prompts/{plan,build}.md` (this repo).
- CLI: `pnpm exec flume <subcommand>` (`tick`, `loop`, `status`, `wake`, `sleep`, `render`).
```

---

## `.flume/chain.ts`

```typescript
/**
 * Runner's Flume chain — plan → build.
 *
 * Loaded by `flume`'s CLI from `.flume/chain.ts`. The default export is the
 * Chain.
 *
 * Two phases (no spec): spec/SPEC.md is human-curated and stable. Plan
 * derives pending.json from SPEC + current src state; build ships entries.
 *
 * SPEC.md edits flow through normal commits, not through a flume phase. If
 * an entry surfaces real spec ambiguity, hand-edit SPEC.md as a separate
 * commit and run `flume tick` (plan) to refresh.
 */

import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Absolute path to this chain.ts directory (.flume/), regardless of cwd. */
const CHAIN_DIR = dirname(fileURLToPath(import.meta.url));

import type {
  Chain,
  Phase,
  TickContext,
  WorktreeSetupContext,
} from "flume/src/Phase.ts";
import type { Gate } from "flume/src/Gate.ts";
import {
  claudeCode,
  withSessionCapture,
  withTerminalRenderer,
} from "flume/src/Agent.ts";
import {
  parsePending,
  renderSchemaForPrompt,
} from "flume/src/PendingSchema.ts";
import { tscGate, vitestGate } from "flume/src/builtinGates.ts";

// ---------- runner-specific gates ----------

/** pending.json conforms to the schema. Reverts plan's commit on violation. */
const pendingParseGate: Gate = {
  name: "pending.json parses",
  when: "afterCommit",
  async run(ctx) {
    let raw: string;
    try {
      raw = await readFile(`${ctx.cwd}/.flume/plan/pending.json`, "utf8");
    } catch {
      return { ok: false, message: "pending.json missing after plan commit" };
    }
    const result = parsePending(raw);
    if (result.ok) {
      return {
        ok: true,
        message: `pending.json parsed (${result.entries.length} entries)`,
      };
    }
    return {
      ok: false,
      message: `pending.json has ${result.errors.length} schema violations`,
      details: result.errors
        .map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
        .join("\n"),
    };
  },
};

/**
 * The runner CLI is distributed as a single esbuild bundle at
 * `plugins/runner/bin/runner`; Claude Code's plugin loader puts that
 * file on PATH (see `.claude/rules/cli-bundle.md`). The gate re-runs
 * `pnpm bundle` after a build commit and reverts if the regenerated
 * bundle (or its vendored `plugins/runner/package.json`) differs from
 * what was committed — i.e. the agent edited a CLI-tree source file
 * without staging a fresh bundle.
 *
 * The gate is allowed to mutate `plugins/runner/bin/runner` in the
 * worktree because that's the same file the build commit owns; harness
 * revert-on-fail resets the worktree alongside the commit. On success,
 * `pnpm bundle` reproduces identical bytes (esbuild output is
 * deterministic for a given input), so `git diff --quiet` exits clean.
 */
const bundleFreshnessGate: Gate = {
  name: "plugins/runner/bin/runner matches src",
  when: "afterCommit",
  async run(ctx) {
    try {
      await execFileP("pnpm", ["bundle"], { cwd: ctx.cwd });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        message: "pnpm bundle failed",
        details:
          (err.stderr ?? "") +
          (err.stdout ?? "") +
          (err.message ?? String(e)),
      };
    }
    const paths = [
      "plugins/runner/bin/runner",
      "plugins/runner/package.json",
    ];
    try {
      await execFileP("git", ["diff", "--quiet", "--", ...paths], {
        cwd: ctx.cwd,
      });
      return { ok: true, message: "bundle matches src" };
    } catch {
      let details = "";
      try {
        const { stdout } = await execFileP(
          "git",
          ["diff", "--stat", "--", ...paths],
          { cwd: ctx.cwd },
        );
        details = stdout;
      } catch {
        // ignore; the failure message is already informative
      }
      return {
        ok: false,
        message:
          "bundle is stale — `pnpm bundle` produced different output " +
          "than what's committed. Re-run `pnpm bundle` and include the " +
          "regenerated bundle in the commit (see .claude/rules/cli-bundle.md).",
        details,
      };
    }
  },
};

/**
 * The bundle ships to users with no node_modules adjacent (Claude Code
 * clones the plugin into ~/.claude/plugins/cache/.../plugins/runner/
 * and adds bin/ to PATH; nothing installs node_modules there). Any
 * un-inlined runtime require — pg, bcryptjs, or any other external —
 * fails with `Cannot find module` once the bundle runs from a path with
 * no ancestor node_modules. The freshness gate catches missing rebundle;
 * this catches the more subtle case where a rebundle succeeded but the
 * bundle isn't actually self-contained (eg. a new `requireFromHere`
 * call site without the literal-arg shape, or a fresh dep that escaped
 * the rewrite plugin).
 *
 * Method: copy the bundle + vendored package.json into a fresh tmpdir
 * outside the worktree, exec `--help`, fail if non-zero. The tmpdir
 * has no ancestor node_modules, so Node's module-resolution walk
 * surfaces any un-inlined runtime require as a hard error.
 */
const bundleSelfContainmentGate: Gate = {
  name: "plugins/runner/bin/runner runs without node_modules",
  when: "afterCommit",
  async run(ctx) {
    const tmpDir = await mkdtemp(join(tmpdir(), "runner-bundle-"));
    try {
      await copyFile(
        join(ctx.cwd, "plugins/runner/bin/runner"),
        join(tmpDir, "bin", "runner"),
      ).catch(async () => {
        // bin/ doesn't exist yet — create then retry
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(tmpDir, "bin"), { recursive: true });
        await copyFile(
          join(ctx.cwd, "plugins/runner/bin/runner"),
          join(tmpDir, "bin", "runner"),
        );
      });
      await copyFile(
        join(ctx.cwd, "plugins/runner/package.json"),
        join(tmpDir, "package.json"),
      );
      await chmod(join(tmpDir, "bin", "runner"), 0o755);
      try {
        await execFileP(join(tmpDir, "bin", "runner"), ["--help"], {
          timeout: 10_000,
        });
        return { ok: true, message: "bundle runs without node_modules" };
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          message:
            "bundle is not self-contained — running from a path with " +
            "no ancestor node_modules failed. Likely an un-inlined " +
            "runtime require survived bundling (see " +
            ".claude/rules/cli-bundle.md).",
          details:
            (err.stderr ?? "") +
            (err.stdout ?? "") +
            (err.message ?? String(e)),
        };
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
};

/**
 * Materialize gitignored-but-required files in a fresh build worktree.
 *
 * `git worktree add` shares .git and tracked working tree but does NOT
 * copy untracked or gitignored files. node_modules and .env are both
 * gitignored; tsc and vitest need them. Symlinks suffice because the
 * worktree shares pnpm-lock.yaml with the main repo.
 */
const buildSetupWorktree = async (
  ctx: WorktreeSetupContext,
): Promise<void> => {
  const linkables = ["node_modules", ".env"];
  for (const name of linkables) {
    const target = join(ctx.repoRoot, name);
    const linkPath = join(ctx.worktreePath, name);
    if (existsSync(target) && !existsSync(linkPath)) {
      await symlink(target, linkPath);
    }
  }
};

// ---------- phases ----------

const plan: Phase = {
  name: "plan",
  description:
    "Re-derive .flume/plan/{pending.json,state.md,open-questions.md} from spec/ + current src state; drain .flume/inbox.md.",
  promptPath: "prompts/plan.md",
  concurrency: "singleton",
  writablePaths: [
    ".flume/plan/pending.json",
    ".flume/plan/state.md",
    ".flume/plan/open-questions.md",
    ".flume/inbox.md",
    // NOTE: plan does NOT touch spec/. The spec corpus (SPEC.md,
    // WAYPOINT-N.md, RESEARCH.md, EVAL-*.md, archive/) is
    // human-curated; if plan discovers ambiguity, it surfaces it
    // via open-questions.md for a human to fold back into SPEC.md.
    //
    // .flume/inbox.md IS writable: plan drains it each tick by
    // routing each entry into pending.json, open-questions.md, or
    // accepted-debt (recorded in the commit body). External writers
    // (/multidim-review, /security-review, /grill, humans) append;
    // plan removes after routing. Plan's own audit findings do NOT
    // pass through inbox — they're written directly to
    // pending.json / open-questions.md, with narrative in the commit
    // body.
  ],
  gates: [pendingParseGate],
  promptArgs() {
    return { PENDING_SCHEMA: renderSchemaForPrompt() };
  },
  handoff(result) {
    const hasPickable = result.pendingAfter.some(
      (e) => e.gate.kind === "open",
    );
    return hasPickable ? ["build"] : [];
  },
};

const build: Phase = {
  name: "build",
  description: "Ship one (or N disjoint) pending entries to the trunk.",
  promptPath: "prompts/build.md",
  concurrency: "fanout",
  writablePaths: [
    "src/**",
    "migrations/**",
    "tests/**",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "vitest.config.ts",
    "Dockerfile",
    "Dockerfile.*",
    "docker-compose.yml",
    "docker-compose.*.yml",
    ".claude/skills/**",
    "examples/**",
    ".gitignore",
    ".env.example",
    "plugins/**",
    ".claude-plugin/**",
    // NOTE: build does NOT touch .flume/plan/pending.json. Harness writes
    // the ship commit post-merge to avoid cherry-pick conflicts.
    // NOTE: build does NOT touch spec/**. The spec corpus is
    // human-curated; if a build entry needs spec clarification, the
    // entry should be blocked and an open question surfaced.
  ],
  gates: [tscGate, vitestGate, bundleFreshnessGate, bundleSelfContainmentGate],
  setupWorktree: buildSetupWorktree,
  promptArgs(ctx: TickContext) {
    if (!ctx.assignedEntry) {
      throw new Error("build phase requires an assignedEntry");
    }
    return {
      ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
      TAG: ctx.assignedEntry.tag,
      PER_PATH: ctx.assignedEntry.per.path,
      PER_SECTION: ctx.assignedEntry.per.section,
    };
  },
  handoff(result) {
    // Wake plan when the wave actually produced signal for it to audit:
    // shipped commits to reconcile, or gate fires that imply MAINTAIN
    // entries. A true no-op wave (nothing pickable, or all picked entries
    // exited cleanly per the writablePaths directive) carries no signal —
    // hibernate. Operator can `flume wake plan` to force a tick.
    if (result.shippedTags.length === 0 && result.gateResults.length === 0) {
      return [];
    }
    return ["plan"];
  },
};

const runnerChain: Chain = {
  phases: [plan, build],
  humanOnly: [], // no spec phase; SPEC.md is edited via normal commits
};

export default runnerChain;

/**
 * Per-tick session capture + condensed terminal output.
 *
 * `claude -p --output-format stream-json --verbose` emits NDJSON per turn
 * (tool calls, content, token usage). withSessionCapture (innermost) tees
 * the raw stream into `.flume/sessions/<timestamp>-<cwd>.jsonl` for cost
 * analysis and replay. withTerminalRenderer (outermost) consumes the same
 * stream and forwards a one-line-per-tool-call summary to the dispatcher's
 * stdout instead of the raw JSON wall.
 */
export const agent = withTerminalRenderer(
  withSessionCapture(
    claudeCode({
      extraArgs: [
        "--output-format",
        "stream-json",
        "--verbose",
        // Stabilize the system prompt for cache reuse: moves per-machine
        // sections (cwd, env, git status) into the first user message.
        // Within an active 5-min cache window, consecutive ticks can hit
        // the cached system prefix instead of rebuilding it.
        "--exclude-dynamic-system-prompt-sections",
      ],
    }),
    {
      // Absolute path so build (which runs in .flume/worktrees/<tag>/) still
      // writes into the main repo's .flume/sessions/. Worktree cleanup would
      // otherwise eat the build transcripts.
      dir: resolve(CHAIN_DIR, "sessions"),
      filename: (inv) => {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const cwdName = inv.cwd.split("/").pop() ?? "tick";
        return `${ts}-${cwdName}.jsonl`;
      },
    },
  ),
);
```

---

## `.flume/inbox.md`

```markdown
# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-
only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- `/multidim-review` — appends a synthesized multi-reviewer audit
  as one dated section.
- `/security-review` — appends security findings.
- `/grill` — when a question surfaces that needs plan routing.

**Plan does not write here.** Plan-tick self-audit findings go
directly to `.flume/plan/pending.json` (file as entry), to
`.flume/plan/open-questions.md` (parked for human input), or live
only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into
one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a
   `per` cite to the relevant SPEC section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human
   input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in
   the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant
to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g., `multidim-review`, `security-review`,
`human`). One subsection per finding cluster; group related items
under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->
```

---

## `.flume/prompts/plan.md`

```markdown
# CURRENT STATE

<pending-json>
!`cat .flume/plan/pending.json 2>/dev/null || echo "[]"`
</pending-json>

<state>
!`cat .flume/plan/state.md 2>/dev/null || echo "(no prior state)"`
</state>

<open-questions>
!`cat .flume/plan/open-questions.md 2>/dev/null || echo "(none)"`
</open-questions>

<spec-toc>
!`grep -nE '^## ' spec/SPEC.md 2>/dev/null || echo "(SPEC.md not found)"`
</spec-toc>

<waypoint>
!`cat spec/WAYPOINT-1.md 2>/dev/null || echo "(no active waypoint)"`
</waypoint>

<inbox>
!`cat .flume/inbox.md 2>/dev/null || echo "(no inbox)"`
</inbox>

<tsc>
!`pnpm tsc --noEmit 2>&1 | tail -15 || true`
</tsc>

<recent-commits>
!`git log -n 10 --oneline`
</recent-commits>

# TASK

Re-derive the plan artifacts from current disk reality. The canonical design lives in `spec/` — human-curated, do not modify. Pending entries are the implementation work breakdown derived from it. **Plan is also the review activity** — auditing what shipped is part of this phase, not a separate process. **Plan also drains `.flume/inbox.md`** — externally-deposited findings (from `/multidim-review`, `/security-review`, `/grill`, or humans) get routed each tick.

**Default posture: research-leaning.** Web search, codebase search, and reading the full cited SPEC/WAYPOINT section are first-line tools, not last-resort fallbacks. When a question surfaces — a divergence, an unclear contract, a candidate entry without a clean cite — research the solution landscape before bailing to `open-questions.md`. Most questions have known-good answers in the ecosystem; the open-questions loop is for genuinely judgment-call decisions and architectural missteps, not for things a 30-second search would resolve. See `.claude/rules/collaboration.md` — *Inform before parking*.

1. **Drain `.flume/inbox.md`.** Walk every entry under the marker. For each, decide one outcome:
   - **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant SPEC section).
   - **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
   - **Accept as debt** — note the disposition + one-line reason in the commit body (no artifact change).
   - **Already addressed** — if a pending entry already covers it, or shipped code resolves it, note in commit body.

   After routing, **remove the entry from inbox.md**. The inbox is a queue, not a log. Do not leave entries sitting after disposition. If you can't decide, park.

2. **Review what shipped since the last plan tick.** Read `<recent-commits>` (above) and the diffs of any commits more recent than the last `plan:` commit. Audit them against the SPEC sections they claim to implement. Look for: spec drift, missed §s, code smells the active waypoint cares about, test coverage gaps, security/data-integrity oversights. **Your findings route directly** — file as pending entries, park as open questions, or accept-as-debt-with-reason in the commit body. **Do not write to inbox.md**; that's an external-contributor surface. The commit body carries the narrative of what this tick observed and routed.

3. **Reconcile** every existing pending entry against the SPEC section named in `per.section` and the files named in `files`. Stale entries get a full rewrite, never a patch. Read `spec/SPEC.md` (or the relevant section) to refresh.

4. **File new observations** as additional entries — drawn from step 2's review findings and from SPEC reconciliation:
   - SPEC sections current code violates or doesn't yet implement → file with `per` cite.
   - tsc / vitest failures → `MAINTAIN-*` entries at the top of pending, deduped by signature.
   - Gated entries whose unblock has shipped → promote to `gate.kind = "open"`.

5. **Respect the active waypoint.** If `spec/WAYPOINT-N.md` is present and names a surface boundary with a "Deferred to waypoint N+1" section, set `gate.kind: deferred` with reason `waypoint-<N+1>-<topic>` on matching entries. Conversely, when an entry's deferral reason no longer applies (the active waypoint advances), promote it back to its natural gate.

6. **Re-derive state.md from scratch** (~5 lines: phase, last shipped tag, in-flight work, what's blocked on what). Never carry forward.

7. **Open questions** belong in `open-questions.md`, never in pending. If a candidate entry can't carry a clean `per` cite into SPEC.md, it's an open question for a human to fold into SPEC.md.

8. **Verify entry file paths against build's `writablePaths`** in `.flume/chain.ts` before filing. If an entry's natural target sits outside that allow-list, build will revert or self-block on every attempt — that's a chain.ts amendment question, not a pending entry. File it as an open question proposing the amendment (or a SPEC change that retargets the file in-scope), with a one-line cite to the writablePaths line.

# OUTPUT

Commit all changes in one commit prefixed `plan:`. Write:

- `.flume/plan/pending.json` — JSON array conforming to the schema below.
- `.flume/plan/state.md` — ~5 line markdown.
- `.flume/plan/open-questions.md` — markdown.
- `.flume/inbox.md` — drained (remove routed entries; preserve the header).

**Commit body carries the audit narrative.** What you observed in the shipped commits, what you routed where, what you accepted as debt and why. This replaces the prior REVIEW.md log; the durable record lives in `git log --format=%B`.

The harness will reject your commit if `pending.json` doesn't parse, or if you modify anything outside the phase's writable paths.

For `per.path`, use `spec/SPEC.md`. For `per.section`, use the exact section heading text from SPEC.md without the leading `## ` (e.g. `3. Data model`, `4. HTTP API (v0.1.0 core)`, `15. Deployment`).

**Field discipline — entry fields are telegraphic.** `files[].description`, `tests[].asserts`, `acceptance`, and `notes` are pointers, not spec restatements (per `.claude/rules/collaboration.md` — *Telegraphic register*). If `description` reads like *"Add X: if input matches /pattern/ then…"*, you're duplicating SPEC; the right shape is *"Widen X per §N."* The `per` cite is the reader's path to mechanics — trust it. Aim for ≤200 chars on uncapped fields; if you can't fit, either the entry is doing too much or you're repeating the spec.

<schema>
{{PENDING_SCHEMA}}
</schema>
```

---

## `.flume/prompts/build.md`

```markdown
# ASSIGNED ENTRY

<entry>
{{ENTRY_JSON}}
</entry>

# THE WHY

Find the section named `{{PER_SECTION}}` in the spec. The rest of the spec is context for the broader design; cross-reference adjacent sections as needed.

<spec path="{{PER_PATH}}">
!`cat {{PER_PATH}} 2>/dev/null || echo "(spec not found: {{PER_PATH}})"`
</spec>

# CONTEXT

<recent-commits>
!`git log -n 5 --oneline`
</recent-commits>

# TASK

Execute the assigned entry. Implement completely — no placeholders, no stubs.

- Touch only the files declared in `entry.files`. Anything else reverts the commit.
- If `entry.files` names paths outside the build phase's `writablePaths` in `.flume/chain.ts`, do not attempt to ship and do not pivot to a different path. Exit without committing; state the path / writablePaths gap in your final message. Plan re-derives next tick and routes it as an open question.
- The acceptance criterion (`entry.acceptance`) must turn green.
- Search before assuming "not implemented" (`rg`, `grep`).
- Schema changes ship as **versioned SQL migration files** in `migrations/` (e.g. `migrations/0002_<slug>.sql`); never edit prior migrations.
- New excluded directories update `tsconfig.json → exclude` AND `.gitignore` in the same commit.

# OUTPUT

One commit on this worktree's branch, prefixed `build:`. Imperative mood. Body explains why; no spec restatement.

Validation gates (tsc, vitest, writable-paths) run automatically. If any gate fails, your commit is reverted and the entry stays in pending.

Do NOT touch `.flume/plan/pending.json` — the harness updates it post-merge.
Do NOT touch `spec/**` — the spec corpus is human-curated.
```

---

## `.flume/plan/state.md`

```markdown
# State

Phase: **W3 cleanup tail — hygiene + perf + lifecycle test debt.** Last ship batch: SKILL-READ-ATTESTATION + ERROR-ENVELOPE-UNIFY + JOB-COMPLETE-FAILURE-MODE + SEARCH-SQL-CONSOLIDATE (f35e1b1).

Queue head: **STALE-COMMENTS-CLEANUP** (drop SHA cite in loop.ts, un-export PoolClient/ConflictCandidate, kill getLenses no-op, fix persist.ts attestation docstring). Then HNSW-EF-SEARCH, MEMORY-PRUNE-PERF, ADMIN-REEMBED, W2 CLI tail, TEST-* coverage, deploy hygiene.

In flight: nothing autonomous.

Open questions: **3** — /runner:init keep/retire (parked); worker-process secrets distribution (§15 amendment); /emit conflicts_with partial-success envelope (§4 amendment).

Tests at trunk: **green.** `pnpm tsc --noEmit` clean. `pnpm test`: 34 files / 483 passed (vitest) + 8 hook subtests (node --test).
```

---

## `.flume/plan/open-questions.md`

```markdown
# Open Questions

These are judgement calls that `spec/SPEC.md` doesn't pin and that the
agent shouldn't decide unilaterally. Fold the chosen answers into
SPEC.md (or a path-scoped rule under `.claude/rules/`) so future ticks
inherit them rather than re-deciding.

## Keep `/runner:init` slash command? — PARKED

Surfaced by 878178a body ("whether to keep init at all is a separate
question, parked"). Source-controlled `.runner/config.json` (now with
optional `server` + `apiKey` per amended SPEC §12) is operator-edit
territory; for tier-1 plugin users the file is committed once per
repo and discovered by walk-up. That makes `/runner:init` redundant
in the source-controlled path — its remaining value is in the
ephemeral / single-user case where the user wants a guided bind step
that validates against `/status` before writing.

**Options.**

- **Keep as-is.** `/runner:init` writes `{ corpus }` only and runs
  `/status` validation. Operator-edited fields stay out of its
  scope. The slash command remains a soft on-ramp.
- **Retire entirely.** Delete `plugins/runner/commands/init.md`.
  Document the manual `cat > .runner/config.json` recipe in SKILL
  prose or WAYPOINT-1 §10.1. Removes one surface for the user to
  learn; users who want validation can `runner status` instead.
- **Narrow to dry-run / validation only.** Slash command no longer
  writes; it only reads the resolved config, hits `/status`, and
  reports. Renames to `/runner:status` or similar.

**Not deciding here.** Wait for usage data — once the team is
running real CI checkouts with committed `.runner/config.json`, the
right answer surfaces from observed behavior. Re-grill when the
shape of that path is clear, or when a related slash-command surface
change forces the call.

## Worker-process secrets distribution — SPEC §15 silent — PARTIALLY ADDRESSED

**Update 2026-05-14 (post-ef0595e):** SEC-WORKER-ENV-FILE shipped
(4355674). The container-level surface is closed — the worker now
materializes a 0600 tmpfile and passes `--env-file` to `docker run`,
so the short-lived `RUNNER_API_KEY` no longer leaks through
`/proc/<pid>/cmdline` or docker-daemon event logs. The narrow
question that prompted the build entry is resolved.

**What remains open.** The *worker process itself* still reads its
three long-lived secrets — `RUNNER_JOB_TOKEN_SECRET`,
`DATABASE_URL`, and the corpus-config OpenAI key — from
`process.env`. SPEC §15's deploy template (line ~1296) lists only
`DATABASE_URL` + `DOCKER_HOST`; it does not pin whether worker
secrets should be inline-env or file-mounted (compose `secrets:` /
k8s `secretFiles`), and does not enumerate the OpenAI key path.

A worker RCE today still surfaces all three: mint write-scope
tokens for any corpus/session, direct DB write, OpenAI burn. The
container-side fix doesn't shrink that surface.

**Options for the §15 amendment.**

- **Secrets-file across all three.** Add `JOB_TOKEN_SECRET_FILE`,
  `DATABASE_URL_FILE`, `OPENAI_API_KEY_FILE` reader paths to the
  worker bootstrap; compose `secrets:` block mounts 0400 to the
  worker user. Mirrors the Postgres-password pattern SPEC §15
  already uses.
- **Inline env (status quo).** Amend §15 to enumerate the missing
  vars + a secret-distribution warning. Smallest diff; least
  defense-in-depth.
- **Per-job-token isolation.** Worker holds only `DATABASE_URL` +
  short-lived OpenAI keys minted per-job from a separate signing
  authority. Largest design change; reframes worker as a less-
  privileged executor. Likely overkill pre-multi-tenant.

Park as a §15 amendment. Pairs with the existing repo-root
`docker-compose.yml` vs SPEC §15 mismatch — both want one §15
rewrite-around-shipped-reality session.

## /emit `conflicts_with` partial-success envelope — SPEC §4 silent — NEEDS AMENDMENT

Surfaced by this tick's audit of 286e8b8 (EMIT-CONFLICT-ENVELOPE).
SPEC §4 declares the three semantic rejections for `conflicts_with`
(self_reference / in_batch / not_found) but does not pin the wire
contract when *some* indices reject and others succeed. The shipped
implementation chose **`HTTP 207 Multi-Status`** with
`{ accepted: AcceptedProposition[], errors: EmitConflictDetail[] }`
— `accepted` is the clean half, `errors` is per-rejected-index with
`{ index, field, code, message }`. Phase-1 commits stand for every
input (content + entities + sources) so re-emit of a rejected index
dedups on content_hash.

The choice is reasonable but unilateral. SPEC §4 should be amended
to either:

- **Bless the shipped shape.** Add a paragraph after the
  `conflicts_with` description: "Partial rejection returns `207
  Multi-Status` with `{ accepted, errors }`; clean indices' Phase-1
  rows stand and re-emit dedups." Smallest diff; cements the
  current wire contract.
- **Mandate full-or-nothing on `conflicts_with`.** Any rejection
  rolls back Phase-1 for that index. Cleaner semantics for callers
  that prefer "either it landed or it didn't"; costs a refactor of
  `persistEmit` to widen the transaction or roll back per-prop on
  conflict-side error.
- **Reframe `conflicts_with` as a soft signal.** Server records what
  it can, never rejects on conflict-side errors, surfaces them as
  warnings on the 201 envelope. Diverges most from current shape;
  changes the SPEC §4 mental model from "validated edges" to
  "best-effort edges".

Park as a §4 amendment. The shipped behavior is internally
consistent and tests pass — there's no live bug. The amendment is
contract-fixation, not bug-fix; pick when the human next touches §4.

## Stuck-`running` reaper for completeJob-exhausted rows — SPEC §16 silent — NEEDS AMENDMENT

Surfaced by this tick's audit of 659b535 (JOB-COMPLETE-FAILURE-MODE).
The new completeJob retry deliberately leaves the row in `running`
when 5 exponential-backoff attempts (50→100→200→400→800ms; ~1.55s
total) all fail — chosen to avoid masquerading a successful
container run as a compile failure. The tradeoff: SSE consumers on
`/jobs/:id/stream` get the `running` notify but never a terminal
event, and no janitor exists to flip the row later. The handler-
deadline branch in `stop()` does flip stuck handlers to `failed`,
but completeJob-exhausted rows survive past worker stop with no
recovery path.

SPEC §16 (Job queue) says nothing about a reaper. For W1 this is
inert (no `/compile`, no `jobs` writers). For W2 it's real debt.

**Options for the §16 amendment.**

- **Periodic reaper.** Background tick in the worker (every N
  minutes) selects `running` rows whose `claimed_at + job_timeout_ms
  < now()` and flips them to `failed` with a "worker abandoned"
  message. Closes both the completeJob-exhausted case and the
  worker-crashed-mid-handler case in one mechanism.
- **On-claim reconciliation.** Worker's `claimNextJob` first scans
  for orphan `running` rows owned by a dead worker (heartbeat
  column or claimed-by-pid tracking) and fails them before picking
  fresh pending rows. Cheaper than periodic but requires a worker
  identity column on `jobs`.
- **Status quo: no reaper.** §16 amendment explicitly accepts that
  exhausted-completeJob rows orphan and SSE consumers must time
  out client-side. Smallest diff; punts recovery to operators.

Park as a §16 amendment. W2 work, paired with /compile shipping
and worker-resilience design. No code action while W1 is in
flight.
```

---

## `.flume/plan/pending.json`

```json
[
  {
    "tag": "STALE-COMMENTS-CLEANUP",
    "summary": "Remove SHA-cite comments + unused exports + no-op wrapper + drifted docstring per `.claude/rules/collaboration.md`",
    "per": {
      "path": "spec/SPEC.md",
      "section": "11. CLI"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "src/worker/loop.ts",
          "description": "Drop SHA cite 'shipped 349b958' (loop.ts:26)"
        },
        {
          "path": "src/jobs/queue.ts",
          "description": "Drop `export type { PoolClient }` (queue.ts:939; no importer outside this file)"
        },
        {
          "path": "src/search/entity.ts",
          "description": "Drop ConflictCandidate from entity.ts:33 re-export tuple AND `export` keyword on src/search/projection.ts:18 — type is search-internal post-SEARCH-SQL-CONSOLIDATE"
        },
        {
          "path": "src/corpus-config.ts",
          "description": "Drop the no-op `getLenses()` wrapper; rewrite callers (server.ts, corpus-config.test.ts, cli-init.test.ts, worker/main.test.ts, worker/loop.test.ts) to use `.lenses` directly"
        },
        {
          "path": "src/emit/persist.ts",
          "description": "Fix validateAttestations docstring (persist.ts:544): says 'Set keys the pair with NUL' but code uses `|` per ATTEST_KEY_SEP (persist.ts:12)"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [],
    "acceptance": "Comments match shipped reality; unused exports retired; docstring agrees with code.",
    "notes": "Severity LOW. status.ts W2-null comment already cleaned by STATUS-LAST-COMPILE-AT (b763360). cli.ts deferred-W2 comment kept — init / image build / serve / admin reembed / ingest all still genuinely deferred. Per spec-plan-build.md clean-slate posture: no `// removed` markers, just delete."
  },
  {
    "tag": "HNSW-EF-SEARCH",
    "summary": "pgvector default hnsw.ef_search=40 < DEFAULT_TOP_K=50 — index plan reaches floor at top-k boundary",
    "per": {
      "path": "spec/SPEC.md",
      "section": "9. Embeddings"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "src/db/client.ts",
          "description": "On connect: SET hnsw.ef_search = 100 (or max(DEFAULT_TOP_K * 2, 80))"
        },
        {
          "path": "src/db/client.test.ts",
          "description": "Pool-acquired client honors ef_search via SHOW"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/db/client.test.ts",
        "asserts": "SHOW hnsw.ef_search returns configured value on freshly-acquired clients"
      }
    ],
    "acceptance": "Default top_k search no longer brushes the ef_search floor; recall holds under nominal load.",
    "notes": "Severity MED. Floor recommendation is ef_search >= topK; pgvector default is 40, DEFAULT_TOP_K is 50."
  },
  {
    "tag": "MEMORY-PRUNE-PERF",
    "summary": "EXISTS predicate against unnest($1,$2) seq-scans proposition_sources — materialize keep set as TEMP TABLE inside the REPEATABLE READ txn",
    "per": {
      "path": "spec/SPEC.md",
      "section": "7. Freshness contract"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "src/admin/memory-prune.ts",
          "description": "Inside the withTransaction block: CREATE TEMP TABLE keep_set(uri, hash, PRIMARY KEY (uri, hash)) ON COMMIT DROP; INSERT from unnest; EXISTS joins against it"
        },
        {
          "path": "src/admin/memory-prune.test.ts",
          "description": "EXPLAIN inclusion check on live PG: planner uses the temp-table index"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/admin/memory-prune.test.ts",
        "asserts": "Live-PG plan uses an index (Hash Join or Index Scan), not Seq Scan + Filter loop"
      }
    ],
    "acceptance": "Prune on 100k-row proposition_sources x 5k-hash keep frame runs in seconds.",
    "notes": "Severity HIGH. Triple-PK can't lead with second column; temp-table-with-index is canonical. MEMORY-PRUNE-TXN shipped (9b27030) — the temp-table lives inside the existing REPEATABLE READ block."
  },
  {
    "tag": "ADMIN-REEMBED",
    "summary": "`runner admin reembed` — SPEC §9 dimensionality-swap recipe primitive (drives /admin/embed/backfill; --dim swaps vector column)",
    "per": {
      "path": "spec/SPEC.md",
      "section": "11. CLI"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [
        {
          "path": "src/cli-reembed.ts",
          "description": "Drives /admin/embed/backfill with progress + retry; --dim flag to swap dimensions per §9"
        },
        {
          "path": "src/cli-reembed.test.ts",
          "description": "Happy path; partial backfill resume; dim-swap migration call"
        }
      ],
      "edit": [
        {
          "path": "src/cli.ts",
          "description": "Register `admin reembed`"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/cli-reembed.test.ts",
        "asserts": "POSTs to /admin/embed/backfill; surfaces progress; exit codes match"
      }
    ],
    "acceptance": "SPEC §9 dim-swap recipe executable end-to-end as one operator command.",
    "notes": "Unblocked — ENTITY-EMBED-BACKFILL shipped (097b017). Bundle regen required."
  },
  {
    "tag": "CLI-IMAGE-BUILD",
    "summary": "`runner image build` — docker build corpus compile image from Dockerfile.corpus per SPEC §5 + §11",
    "per": {
      "path": "spec/SPEC.md",
      "section": "11. CLI"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [
        {
          "path": "src/cli-image.ts",
          "description": "Read corpus.config.yml#image.{tag,dockerfile}; spawn docker build; pipe stdio"
        },
        {
          "path": "src/cli-image.test.ts",
          "description": "Reads config; correct docker invocation shape; missing config -> exit 2"
        }
      ],
      "edit": [
        {
          "path": "src/cli.ts",
          "description": "Register `image build`; folded into STALE-COMMENTS-CLEANUP for deferred-list edit"
        },
        {
          "path": "src/cli.test.ts",
          "description": "Drop `image` from absent-commands assertion (cli.test.ts:300)"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/cli-image.test.ts",
        "asserts": "spawns `docker build -t <image.tag> -f <image.dockerfile> .`; no config -> exit 2"
      }
    ],
    "acceptance": "Operator runs `runner image build` after `runner init <name>`; corpus compile image is built + tagged per corpus.config.yml#image.tag.",
    "notes": "Bundle regen required. Required for SPEC §10.4 bootstrap; init scaffold tells operators to run a command that doesn't exist."
  },
  {
    "tag": "CLI-SERVE-UP-DOWN",
    "summary": "`runner serve {up,down}` — thin `docker compose` wrappers per SPEC §11",
    "per": {
      "path": "spec/SPEC.md",
      "section": "11. CLI"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [
        {
          "path": "src/cli-serve.ts",
          "description": "Spawn docker compose up -d / docker compose down; cwd-aware; pipe stdio"
        },
        {
          "path": "src/cli-serve.test.ts",
          "description": "Argv -> docker compose invocation; up/down distinct"
        }
      ],
      "edit": [
        {
          "path": "src/cli.ts",
          "description": "Register `serve up|down`"
        },
        {
          "path": "src/cli.test.ts",
          "description": "Drop `serve` from absent-commands assertion"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/cli-serve.test.ts",
        "asserts": "up -> docker compose up -d; down -> docker compose down; non-zero exit propagates"
      }
    ],
    "acceptance": "`runner serve up` / `runner serve down` round-trip the compose stack; direct `docker compose` still works.",
    "notes": "Lowest W2-CLI priority — thin passthrough."
  },
  {
    "tag": "TEST-WORKER-LOOP",
    "summary": "loop.test.ts covers bridge-row paths only — timedOut / non-zero exit / signal / stderr-tail / dispose-throws branches still uncovered",
    "per": {
      "path": "spec/SPEC.md",
      "section": "5. Server-side compile (the remote claude environment)"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "src/worker/loop.test.ts",
          "description": "Extend with: timedOut → handler throw + dispose still ran; exitCode !== 0 → handler throw with stderr tail; signal exit reported in error; dispose-throws path (the loop.ts:188-190 'best-effort cleanup' comment claims swallowing but the await is unguarded — pin the actual behavior)"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/worker/loop.test.ts",
        "asserts": "timedOut, non-zero exit, signal exit, dispose-throws branches exercised; tail() truncation observed in error message"
      }
    ],
    "acceptance": "Refactors to loop.ts surface regressions via vitest, not integration drift.",
    "notes": "Severity MED (was HIGH). WORKER-COMPILE-SESSION-RESOLVE shipped 5 tests covering bridge-row resolve / missing-bridge / non-compile kinds. Remaining branches are the spawn-result discriminator + worktree cleanup, where loop.ts:187-191's 'best-effort cleanup' comment may not match the unguarded `await worktree.dispose()` — a test will pin which behavior is canonical."
  },
  {
    "tag": "TEST-COMPILE-E2E",
    "summary": "No end-to-end /compile pipeline test — enqueue -> claim -> container-spawn -> emit-back -> SSE-notify has zero direct coverage",
    "per": {
      "path": "spec/SPEC.md",
      "section": "5. Server-side compile (the remote claude environment)"
    },
    "gate": {
      "kind": "requiresDockerHost"
    },
    "files": {
      "new": [
        {
          "path": "src/compile.e2e.test.ts",
          "description": "Live PG + docker-host: POST /compile, follow SSE, observe inner container's /emit landing in propositions"
        }
      ],
      "edit": [],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/compile.e2e.test.ts",
        "asserts": "/compile-issued job emits >=1 proposition; /search retrieves it; SSE shows started + emitted + finished"
      }
    ],
    "acceptance": "The §4 + §5 contract end-to-end asserted on a docker host.",
    "notes": "Severity HIGH. requiresDockerHost lets CI skip until a worker-capable runner exists; local devs run via RUNNER_E2E=1. Catches WORKER-COMPILE-SESSION-RESOLVE regressions in addition to the broader pipeline."
  },
  {
    "tag": "TEST-SEARCH-LIVE-PG",
    "summary": "fts.test + entity.test simulate ranking in JS — real PG dict / HNSW unexercised",
    "per": {
      "path": "spec/SPEC.md",
      "section": "6. Search — what the agent actually does"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [
        {
          "path": "src/search/entity.live.test.ts",
          "description": "Live-PG: insert entities + props; assert HNSW cosine ranking + RRF math agree across queries"
        },
        {
          "path": "src/search/fts.live.test.ts",
          "description": "Live-PG: assert 'english' dict stemming + ts_rank_cd ordering"
        }
      ],
      "edit": [],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/search/entity.live.test.ts",
        "asserts": "real index ordering matches expected; dict / opclass / m / ef_construction changes surface in test"
      }
    ],
    "acceptance": "Migration changing dictionary, opclass, or HNSW params is caught by tests.",
    "notes": "Severity HIGH. Skip-on-no-PG matches existing ctx.skip convention. projection.test.ts (shipped 204a41d) covers row-shape parity across entity + FTS, not ranking math — this entry is the ranking-math complement."
  },
  {
    "tag": "DB-STATEMENT-TIMEOUT",
    "summary": "No statement_timeout on pool clients — a stuck query blocks a client indefinitely",
    "per": {
      "path": "spec/SPEC.md",
      "section": "15. Deployment"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "src/db/client.ts",
          "description": "Pool client onConnect: SET statement_timeout = $RUNNER_DB_STATEMENT_TIMEOUT (default 30s)"
        },
        {
          "path": "src/db/client.test.ts",
          "description": "Env var + default; SHOW echoes value"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/db/client.test.ts",
        "asserts": "fresh client has expected statement_timeout"
      }
    ],
    "acceptance": "A runaway query times out cleanly without holding the pool slot forever.",
    "notes": "Severity LOW. Trivial; high defensive value."
  },
  {
    "tag": "POOL-ERROR-EXIT-DEFAULT",
    "summary": "RUNNER_POOL_ERROR_EXIT default '0' — supervisor-managed containers prefer exit-then-restart over hobbling",
    "per": {
      "path": "spec/SPEC.md",
      "section": "15. Deployment"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "src/main.ts",
          "description": "Default '1'; keep env override for development"
        },
        {
          "path": "src/main.test.ts",
          "description": "Default path exits on pool error"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/main.test.ts",
        "asserts": "default behavior exits; env override '0' is preserved for opt-out"
      }
    ],
    "acceptance": "k8s / compose restart-on-failure produces a fresh pool when DB recovers.",
    "notes": "Severity LOW. Default-flip-for-prod-safety; dev opt-out preserved."
  },
  {
    "tag": "BARE-REPO-LOCK-RETRY",
    "summary": "bareRepoLocks deletes on reject — concurrent awaiters all retry clone from cold against a flaky remote",
    "per": {
      "path": "spec/SPEC.md",
      "section": "5. Server-side compile (the remote claude environment)"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "src/worker/worktree.ts",
          "description": "On lock-promise reject, awaiters see the failure (don't retry in lockstep); first new caller retries"
        },
        {
          "path": "src/worker/worktree.test.ts",
          "description": "Concurrent ensureBareRepo cold + remote failure: N callers see N-1 failures + 1 cause; not N concurrent clones"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/worker/worktree.test.ts",
        "asserts": "thundering-herd-on-failure suppressed; subsequent attempt retries cleanly"
      }
    ],
    "acceptance": "Flaky network on first-job-after-deploy doesn't fan into N concurrent clones.",
    "notes": "Severity LOW. worktree.ts:56,76-78 finally-deletes the lock; awaiters all retry."
  },
  {
    "tag": "PACKAGE-JSON-HYGIENE",
    "summary": "flume in dependencies (should be devDependencies); no engines.pnpm",
    "per": {
      "path": "spec/SPEC.md",
      "section": "15. Deployment"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "package.json",
          "description": "Move flume -> devDependencies; add engines.pnpm: '>=9'"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [],
    "acceptance": "Production install excludes flume; CI pins to pnpm major.",
    "notes": "Severity LOW. One-line edits."
  },
  {
    "tag": "EXAMPLE-CARTOGRAPH-FIX",
    "summary": "examples/cartograph-export.mjs:14-15 pipes into `runner symbols import -` — `symbols` subcommand does not exist",
    "per": {
      "path": "spec/SPEC.md",
      "section": "11. CLI"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [],
      "edit": [
        {
          "path": "examples/cartograph-export.mjs",
          "description": "Replace stale `runner symbols import` reference with a working pipe target (or drop the example if no live target exists)"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [],
    "acceptance": "Example runs as documented or is retired honestly.",
    "notes": "Severity LOW. If no symbols ingestion exists, retire the example pending a real W2+ flow."
  },
  {
    "tag": "HELPER-READ-POSITIVE-INT",
    "summary": "readPositiveInt(raw, fallback) declared three times identically in main.ts:254, server.ts:302, db/client.ts:112",
    "per": {
      "path": "spec/SPEC.md",
      "section": "15. Deployment"
    },
    "gate": {
      "kind": "open"
    },
    "files": {
      "new": [
        {
          "path": "src/env.ts",
          "description": "readPositiveInt + small env-parsing helpers"
        }
      ],
      "edit": [
        {
          "path": "src/main.ts",
          "description": "Import from env.ts; drop local copy"
        },
        {
          "path": "src/server.ts",
          "description": "Import from env.ts; drop local copy"
        },
        {
          "path": "src/db/client.ts",
          "description": "Import from env.ts; drop local copy"
        }
      ],
      "retire": []
    },
    "schemaDelta": "none",
    "tests": [
      {
        "path": "src/env.test.ts",
        "asserts": "positive int / fallback semantics covered once"
      }
    ],
    "acceptance": "One helper, six call sites, one test.",
    "notes": "Severity MED. Three identical copies is the floor for extraction. db/client.ts is bundled CLI-tree — bundle regen required after adding env.ts to the bundle graph."
  }
]
```

---

## Things deliberately not included

These exist in the live repo but are runtime / per-machine state, not
configuration:

- `.flume/awake/` — phase baton (single file naming the awake phase).
- `.flume/sessions/*.jsonl` — per-tick `claude -p` stream-json captures.
- `.flume/worktrees/<tag>/` — build phase's git worktrees.
- `.claude/settings.local.json` permissions list — kept above because it
  *was* checked in; it's per-user but lives in the repo.
- The CLI bundle itself (`plugins/runner/bin/runner`) — derived
  artifact, regenerated by `pnpm bundle`.
- `node_modules/flume/` — the Flume runtime dep referenced by
  `chain.ts` (`flume/src/Phase.ts`, `flume/src/Gate.ts`,
  `flume/src/Agent.ts`, `flume/src/PendingSchema.ts`,
  `flume/src/builtinGates.ts`). Installed from `Jwcjwc12/flume`.
- The `spec/` corpus — referenced everywhere but it's the Runner
  project's domain content, not a template-reusable artifact.

## How the pieces wire together (one-paragraph map)

`CLAUDE.md` is the agent's first read; it points at `spec/SPEC.md` for
domain truth and at `.flume/PROTOCOL.md` for workflow truth.
`.claude/settings.json` disables auto-memory (forcing all context into
the repo) and registers a PostCompact hook that tells the agent to run
`/core`. `.claude/commands/*.md` are slash-command prompts the human
or harness invokes. `.claude/rules/*.md` are operational rules the
agent re-reads on demand. `.claude/skills/grill/SKILL.md` is the
human-grilling interview skill for resolving open questions.
`.claude-plugin/marketplace.json` + `plugins/runner/` package the
`runner` CLI, the `runner` skill (with its just-in-time
`emit-discipline.md` reference), the `/runner:init` slash command, and
the `PostToolUse` hook on `Read` that attests source bytes to the
server. `.flume/chain.ts` declares the plan/build phase shapes,
writable paths, and gates (tsc, vitest, bundle-freshness,
bundle-self-containment, pending-parse) and wires the Claude-Code
adapter with session capture + terminal rendering.
`.flume/prompts/{plan,build}.md` are the templates each phase's
`claude -p` invocation receives, hydrated with current disk state.
`.flume/plan/{pending.json,state.md,open-questions.md}` are the
plan-phase outputs the build phase reads as its assignment queue.
`.flume/inbox.md` is the transient ingestion queue for external
reviewers (`/multidim-review`, `/security-review`, `/grill`, humans)
that the plan phase drains every tick.

End of compilation.
