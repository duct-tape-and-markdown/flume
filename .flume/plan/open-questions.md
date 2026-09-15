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

## `spec/cli.md` still calls the exports map single-entry (NEEDS AMENDMENT)

Swept out of the harness-bin neighborhood. `spec/cli.md:348` reads "ESM-only:
`"type": "module"`, Node ≥ 22, one strict `"."` export." The map has carried
two entries since the harness package shipped: `package.json:24-33` declares
`"."` and `"./harness"`, and `spec/chain.md:715-719` already states the pair by
name ("**A strict, enumerated `exports` map.** `"."` and `"./harness"`").

Why it is worth a park rather than a debt line: derive reads this corpus as
current truth, and the two sentences disagree about a shape a change would act
on. A derive tick that lands on `spec/cli.md` can file a perfectly cite-clean
entry to narrow the map back to one entry — which breaks every consumer
importing `@dtmd/flume/harness`. Plan cannot fix it (spec is the human's
surface) and build cannot (spec is outside its fence), so it stays here until
someone edits the line.

Recommended: strike the clause rather than restate the pair. The same bullet
already says "The export map, its condition, and the reason are the packaging
half of the chain-loading contract — see `spec/chain.md`", so the count is a
second copy beside the source it defers to. Dropping five words leaves
`"type": "module"` and the node floor, and `spec/chain.md` stays the one home.

Alternative, if the ESM-only bullet should stay self-contained: replace "one
strict `"."` export" with "a strict, enumerated exports map (`spec/chain.md`)"
— still a pointer, no number to drift.
