# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## The release publish is hand-run, and `spec/cli.md` ratifies that (PARKED — needs a spec amendment)

Drained from the inbox (2026-09-08, human via flume-main). 0.14.0's publish
stalled a day on a dead token: CLAUDE.md named a key `.env` did not hold, the
key it did hold had expired in May, and `pnpm publish` ignored the env-var auth
form and read `~/.npmrc`, surfacing as a 404 on the PUT. Tag and commit were
already pushed, so the registry lagged the tag by a day.

**Not derivable as filed.** `spec/cli.md` *Versioning policy* currently states
"The version bump and `npm publish` are human-performed at cut time." A tagged
CI publish contradicts that line, so the line moves first.

Shape the finding proposes, carried here so the answering session need not
re-derive it — temper's `.github/workflows/release.yml`: `on: push: tags:
["v*"]`, publish with `secrets.NPM_TOKEN` through `setup-node`'s
`registry-url`, **idempotent** (skip when `npm view <pkg>@<version>` already
resolves), and a post-publish smoke that installs the published tarball from
the registry and runs the shim — `scripts/smoke-install.mjs` already does this
against a local pack; the job points it at the registry.

Two things are the operator's regardless of the ruling: setting the repo
secret, and whether release automation is wanted at all for a package whose
cut is deliberately hand-curated (changelog mining, `smoke:install`).
`.github/**` is already inside build's fence, so the work ships the moment the
spec line moves.

## `spec/pending.md`'s export roster does not name `gitPath` (PARKED — the human's file)

Drained from `FLUMEAPI-GITPATH-REPORTED`'s note; verified on disk this tick.
`gitPath` rides both canonical lists — `src/index.ts:72` and `FlumeApi`
(`src/flumeApi.ts:135`) — and the sentence that enumerates them names it in
neither: `spec/pending.md`, *What the package exports* reads "`src/index.ts`
and `FlumeApi` are the canonical lists. Both carry the *values*
`composePendingList` … `slugify`, and `priorAttemptPath`." It reads exhaustive
and is not. The omission predates the entry that put `gitPath` on the API.

A second, narrower site: `spec/chain.md`, *The chain is a plugin, not a
consumer* names "the path-glob matcher `matchesAny`" as the engine rule a
chain reaches for path policy rather than hand-rolling. The host-path-to-git-
path rule is now reachable the same way and beside it in the same sentence's
scope, and goes unnamed. (`matchesAny` itself is correctly absent from the
`spec/pending.md` roster — it rides `FlumeApi` only, never `src/index.ts`, so
"both carry" excludes it.)

Options:

- **Transcribe.** Add `gitPath` to the roster and the separator rule to
  `spec/chain.md`'s sentence. Cheapest, and leaves a hand-maintained list that
  goes stale at the next export — which is how this one got here.
- **State the property, not the roster** (recommended). Say what makes a value
  canonical — the two lists carry the same values, and the `.d.ts` doc-comment
  scan the carve-out sanctions is what holds them — so a later export needs no
  spec edit. `spec/cli.md`'s install-fixture sentence took exactly this shape
  at `d5c05b9`; the same move, one file over.
- **Accept.** The roster is the human's own surface and the ladder does not
  administer it. Costs the next omission.

Parked because `spec/` is the human's alone; build cannot reach it and plan
picking a wording would be plan authoring spec.
