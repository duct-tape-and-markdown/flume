# State

Phase: **v0.1 public-release prep — tagging gate.** Mode this tick: **audit** — the only live delta is one `build:` commit (`ea8b4e7`) plus the harness drain `chore` (`0e5f8b3`). Spec unchanged, inbox empty, no `blockedBy` entries.

- Audited `ea8b4e7 build: gate publish-acceptance in CI` against its cite (§8 owns `ci.yml`; justified by §4 L106 + §2 L64/§4 L108). **Faithful, accepted, no action.** attw step = §2 L64 verbatim. Consumer-smoke covers §4 L106 and correctly strengthens it with `flume render` (status never loads chain.ts → exports-map resolution otherwise unproven), consistent with the shipped entry's own notes. Scope clean (only `ci.yml`, = `files.edit`). Mechanics verified against `package.json`: TARBALL name correct for scoped pkg, `bin.flume` resolves under `npx --no-install`, `tsx`/`zod` declared as deps so `render` resolves. No drift, no scope creep, no gate-bypass.
- Two spec-surface findings escalated to open-questions (plan cannot edit `spec/`):
  - **§8 enumeration vs shipped CI** (NEEDS AMENDMENT). Prior ticks flagged this as commit-body debt while unshipped; it has now shipped and stabilized, and the inconsistency is internal (§4 L106 points at §8 for a step §8 doesn't enumerate). Escalated from transient debt to a parked spec-edit so §8 describes the CI it gates on before the tag.
  - **§4 L107 unenforced** (PARKED). `npm pack --dry-run` "only the files listed" has no CI guard and no pending entry; smoke covers missing-file but not tarball-over-inclusion. Spec-silent on whether L107 is CI-enforced (unlike L106's explicit "in CI"). Not silently derived, not silently dropped — parked with recommendation A (cheap CI guard).

Queue: empty. No code work is unambiguously derivable this tick: spec unchanged (no derive trigger), audit found no drift requiring a fix entry, inbox empty, nothing to promote. Filing L107 as a pending entry would be deriving against a spec-silent point — forbidden by `spec-plan-build.md` until the human resolves it.

In flight: nothing. Remaining v0.1 acceptance is out-of-band human work:
- Resolve the two open questions above (spec edits to §8 / §4).
- Choose the final scope name; `@jwcjwc12/flume` is a placeholder (recorded in CHANGELOG at the v0.1 tag, per §4).
- Land a CI-green PR on `main` (§8 acceptance) and tag v0.1.

Open questions: 2.

Trunk: delta is CI-only (no `src/`/`tests/` change since the last green check) — `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 68 tests); `pnpm build` clean `.d.ts`. Still green.

Plan continues: no
