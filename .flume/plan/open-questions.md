# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## Old-engine blind spot in the pin handshake (structural)

**PARKED**

v0.7 §10 (`spec/RELEASE-v0.7.md:224`) ships the launcher-defers-to-pin
handshake as code inside the *global* `flume` binary
(`engineHandshake`, `src/cli.ts:240-267`). MIGRATING-0.8.md §4 tells a
0.6.x-bay operator this is "a hard stop, not a silent fallback to
PATH" — but that guarantee is itself >=0.7 code. The guide's stated
audience is exactly the population whose installed global binary
predates the handshake, so for them it cannot fire: their old engine
silently runs the upgraded chain under stale schema semantics until a
render fails downstream. Confirmed twice independently (platform's 0.8
upgrade; platform's dal-migration branch). No spec section addresses
the pre-handshake-engine case — this is a gap in the handshake's
threat model, not a bug in its implementation. (MIGRATION-GUIDE-HANDSHAKE-SCOPE,
filed separately, only corrects the guide's wording — it doesn't
resolve this.)

Options:

1. **Guide-only correction** (already filed as a pending entry).
   Cheapest; doesn't fix the recurring shape — every future line has
   the same "bay ahead of any reachable old engine" problem, and it
   relies on the operator reading an ordering instruction correctly
   under the exact failure mode being warned about.
2. **Chain-side trip-wire.** A chain intending to require >=N imports
   an export that only exists at >=N, so a pre-N engine's `tsx` load
   of `chain.ts` throws at module resolution instead of running
   silently. Needs the engine to guarantee some stable "trip" export
   per boundary release, and needs every downstream chain to actually
   add the import — a convention every future MIGRATING-*.md would
   have to teach.
3. **Accept as a documented non-goal** of the launcher-defers-to-pin
   design, named explicitly in v0.7 §10 rather than implied.

Also worth confirming: does v0.7 §10's acceptance criteria implicitly
assume the invoking binary is always current? If so that assumption
should be named in the spec regardless of which option is chosen.

Recommended: decide between (2) and (3); (1) ships either way and
doesn't preclude either.

## Bay-manifest pin placement (carto residual)

**PARKED**

`readPin` (`src/cli.ts:142`) only reads `<repoRoot>/package.json`, where
`repoRoot` is resolved by §9's walk-up-from-cwd. carto's report implies a
topology where the true "bay" and the pin's home diverge, but `job.ts` has
no `<flumeDir>/package.json` concept at all — verified, no such path is
ever written — so there is no second manifest to consult short of
inventing one. v0.7 §10 says "the bay's `package.json`" without pinning
down whether "bay" always means the walked-up `repoRoot` or could mean a
nested subdirectory.

Options:

1. **Guide-only clarification.** State in `docs/MIGRATING-0.8.md`'s
   pin-placement bullet that the pin must live in the same `package.json`
   found at the walked-up bay root (§9), not any nested or job-scoped
   manifest. Zero code change; matches actual current behavior.
2. **Extend `readPin` to also check `<flumeDir>/package.json`.** No
   existing writer for that path — introduces a new manifest location
   with no other consumer, absent a demonstrated topology that needs it.

Recommended: (1), unless carto can name a concrete repo topology where the
walked-up bay root and the pin's intended home genuinely diverge — if so,
that's a v0.7 §10 amendment, not a plan-derived guess.

## pendingGate — report both violation classes in one pass (inbox finding 3)

**PARKED**

`pendingGate` (`src/builtinGates.ts:243-306`, v0.8 §6) calls `parsePending`,
which is all-or-nothing over the whole entry array (`z.array(...).safeParse`)
— a single entry's schema violation (e.g. an undeclared field) fails the
entire parse with no `entries` to fence-check, so a sibling entry's fence
violation only surfaces after the schema issue is fixed, costing a second
correction round (carto, observed). `parsePendingLoose` already exists as a
lenient sibling but is documented read-path-only (status-class commands)
and is itself still all-or-nothing at the array level — it doesn't solve
this.

Options:

1. **Partial per-entry parse mode** (some entries ok, some errored, in one
   pass) — changes `parsePending`'s return contract, a real semantics
   change beyond `pendingGate` itself.
2. **Keep fail-fast, improve the message** to note that fence violations
   may exist among the unparsed entries and will surface next round —
   cheap, no semantics change, doesn't actually collect both classes.
3. **Leave as-is.** Two-round correction is a UX cost, not a correctness
   defect — no entry ever ships without both checks eventually passing.

Recommended: lean (3) unless the two-round cost proves expensive in
practice — (1) is disproportionate machinery for a UX papercut, (2) barely
helps. Every real fix here is heavier than the problem it solves
(collaboration.md's complexity signal).

## setupWorktree/gate install-options & manager-detection sharing (inbox finding 4)

**PARKED**

`setupWorktree(dir)` (`src/setupWorktree.ts`) takes no options — install
commands are hardcoded arrays; v0.7 §11's acceptance/non-goals text locks
the exact `pnpm install --frozen-lockfile` / `npm ci` shape with no options
surface. Separately, `tscGate`/`vitestGate`/`eslintGate`
(`src/builtinGates.ts:111-143`) hardcode `cmd: "pnpm"`, independent of
`setupWorktree`'s own lockfile-sniffing — no shared detection helper
exists, and no spec section covers gates auto-detecting the package
manager (v0.1 §2's public-API list names the gates, not this behavior).

Options:

1. **Spec amendment.** Extend §11 with an optional `{ args?, env? }` on
   `setupWorktree` and describe a shared manager-detection helper the
   pnpm-hardcoded gates adopt — becomes a normal derive-from-spec entry
   once written.
2. **Decline, chain-side workaround.** A chain wanting `--no-audit
   --no-fund` or `CI=true` can already wrap `setupWorktree` itself; a
   chain wanting non-pnpm `tsc`/`vitest` can hand-roll `shellGate`.

Recommended: (1) — the asymmetry (`setupWorktree` already detects the
manager, the gates don't) is a real duplication smell per
engine-boundary.md — but the exact options shape is a spec author's call,
not plan's to invent silently.
