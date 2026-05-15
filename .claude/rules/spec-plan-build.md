# Spec → Plan → Build

The writing pipeline flows forward. Each layer has one author and one artifact home. Reaching backward breaks the trust the next layer depends on.

| Layer | Artifact | Author | Phase | Commit prefix |
| ----- | -------- | ------ | ----- | ------------- |
| spec  | `spec/**` (`RELEASE-v0.1.md`, future spec files), `.claude/rules/*.md` | human | — | (any) |
| plan  | `.flume/plan/{pending.json,state.md,open-questions.md}`, `.flume/inbox.md` | plan tick (drains inbox) | `plan:` | `plan:` |
| inbox | `.flume/inbox.md` — transient findings queue | external reviewers (humans; future review skills) | (any session) | (any) |
| code  | `src/`, `tests/`, `bin/`, `examples/`, `docs/`, `vitest.config.ts`, `.env.example`, `.gitignore`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `.github/**` | build tick | `build:` | `build:` |

Harness commits use `chore(flume):`.

## Directives

- **`spec/` is the human's maintenance surface.** Autonomous flume phases (plan, build) never edit it — chain.ts writable-paths is the hard boundary. Interactive sessions edit `spec/RELEASE-v0.1.md` (or future spec files) *under explicit human direction*, with per-edit approval; the human is the author, the agent is the editor.
- **pending.json is derived, not authored.** Plan re-derives it every tick from spec + open-questions + inbox + current src. Never hand-edit. Cross-tick context belongs in `.flume/plan/open-questions.md`.
- **Open questions go in `.flume/plan/open-questions.md`, not in pending.json.** If a candidate plan entry can't carry a clean `per` cite into the spec, it's a question for a human.
- **`.flume/inbox.md` is a transient queue, not a log.** External reviewers append findings; plan drains every tick. Each entry leaves the inbox by becoming a pending entry, an open question, or an accepted-debt note in the `plan:` commit body. Plan does NOT write to inbox — its self-audit findings route directly to pending/open-questions, with narrative in the commit body.
- **Build writes code; plan writes plan artifacts; humans write spec.** No layer reaches into another's lane. Cross-cutting fixes get filed as plan entries, not patched directly.
- **Pre-1.0 clean-slate posture on API changes.** Flume is pre-1.0. When a spec change implies an API or schema shape change, **edit the existing source in place** — no backwards-compat shims, no `// removed` markers for deleted code, no renamed-`_` placeholders for unused params. The runtime is recreated; that's the cost of moving fast. After 1.0, this directive flips.

**Why:** the pipeline only works when each layer trusts the upstream artifact. Build trusts plan trusts spec. If build edits plan artifacts (or plan edits spec), the agent re-discovers the same questions every tick and the trust collapses.
