# Spec → Plan → Build

The writing pipeline flows forward. Each layer has one author and one artifact home. Reaching backward breaks the trust the next layer depends on.

| Layer | Artifact | Author | Phase | Commit prefix |
| ----- | -------- | ------ | ----- | ------------- |
| spec  | `spec/**` (topic files: loop, chain, prompt, pending, cli, jobs, worktrees), `.claude/rules/*.md` | human | — | (any) |
| plan  | `.flume/plan/{pending.json,state.md,open-questions.md}`; drains `.flume/inbox/`, `.flume/plan/notes/` | plan tick | `plan:` | `plan:` |
| inbox | `.flume/inbox/<date>-<slug>.md` — transient findings queue, one file each | external reviewers (humans; future review skills) | (any session) | (any) |
| notes | `.flume/plan/notes/<TAG>.md` — one file per entry, build's only cross-tick channel | build tick | `build:` | `build:` |
| code  | `src/`, `tests/`, `bin/`, `examples/`, `docs/`, `vitest.config.ts`, `.env.example`, `.gitignore`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `.github/**` | build tick | `build:` | `build:` |

Harness commits use `chore(flume):`.

## Directives

- **`spec/` is the human's maintenance surface.** Autonomous flume phases (plan, build) never edit it — chain.ts writable-paths is the hard boundary. Interactive sessions edit `spec/*.md` *under explicit human direction*, with per-edit approval; the human is the author, the agent is the editor.
- **pending.json is derived, not authored.** Plan re-derives it every tick from spec + open-questions + inbox + current src. Never hand-edit. Cross-tick context belongs in `.flume/plan/open-questions.md`.
- **Open questions go in `.flume/plan/open-questions.md`, not in pending.json.** If a candidate plan entry can't carry a clean `per` cite into the spec, it's a question for a human.
- **Records are one file each, and the directories are queues, not logs** (`.flume/PROTOCOL.md`, *Records: one file each*). External reviewers add a file under `.flume/inbox/`; a build tick writes its entry's note under `.flume/plan/notes/`; plan drains both every tick. Each record leaves by becoming a pending entry, an open question, or an accepted-debt line in the `plan:` commit body, and its file is deleted. Plan does NOT create records — its self-audit findings route directly to pending/open-questions, with narrative in the commit body.
- **Build writes code; plan writes plan artifacts; humans write spec.** No layer reaches into another's lane. Cross-cutting fixes get filed as plan entries, not patched directly.
- **Pre-1.0 clean-slate posture on API changes.** Flume is pre-1.0. When a spec change implies an API or schema shape change, **edit the existing source in place** — no backwards-compat shims, no `// removed` markers for deleted code, no renamed-`_` placeholders for unused params. The runtime is recreated; that's the cost of moving fast. After 1.0, this directive flips.

**Why:** the pipeline only works when each layer trusts the upstream artifact. Build trusts plan trusts spec. If build edits plan artifacts (or plan edits spec), the agent re-discovers the same questions every tick and the trust collapses.
