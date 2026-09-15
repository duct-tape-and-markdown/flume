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

## A TypeScript module-resolution fact lives in a code comment; `platform-facts.md` is its home (NEEDS AMENDMENT — a rule-page edit no phase can make)

Drained from the build note on `EXPORT-NAMEABILITY-READS-THE-DECLARATION-EMIT`.
Making the export scan's in-memory declaration program resolve took one
non-obvious fact, verified at `tests/helpers/exportGraph.ts`:

> TypeScript's module resolution abandons a lookup whose containing directory
> it believes is absent, so a host serving a virtual `outDir` must answer
> `directoryExists`, not only `fileExists` and `readFile`. Without it every
> cross-module import resolves to `unknown` and the scan reports an empty
> reach graph as a clean surface.

External toolchain behavior: no test pins it and no type holds it, which is
`.claude/rules/platform-facts.md`'s charter (CLAUDE.md, *Tech Stack*). It sits
today as a comment at the site — a copy the harness should own instead, seen
only by an agent who already opened that file.

`.claude/rules/**` is inside the spec locus and inside no phase's fence, so
neither build nor plan can move it; the operator's edit is the only route.

**Recommended:** add the fact to `platform-facts.md`, and the follow-on ships
as an ordinary entry — the site comment shrinks to a pointer
(`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*), the
one half of this that is inside build's fence. Nothing else is blocked.
