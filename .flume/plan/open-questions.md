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
