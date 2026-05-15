# State

Phase: **v0.1 public-release prep — tagging gate.** Mode this tick: **maintain** — inbox-drain is the only meaningful delta dimension (the lone commit-delta is a human inbox append; no code/spec to audit).

- Drained the one inbox entry (CI missing two §4/§2 publish-acceptance gates, human, 2026-05-15). Routed as a **single** pending entry `CI-PUBLISH-ACCEPTANCE`, not two: both gaps edit the same artifact (`.github/workflows/ci.yml`), so two entries would only force fanout serialization with a cherry-pick bounce for zero benefit. The human explicitly sanctioned "one with two file targets."
- The prior tick's "a true consumer-install test requires publish-first" disposition (old state.md L16) is **superseded**: `npm pack` produces the exact tarball; installing the `.tgz` into a tmp consumer exercises the real install path with no publish. The human's finding corrects that reasoning; the route is now clean, not parked.

Queue: `CI-PUBLISH-ACCEPTANCE` (open) — head and only entry.

In flight: nothing. After this entry ships, remaining v0.1 acceptance is out-of-band human work:
- Choose the final scope name and replace `@jwcjwc12/flume` in `package.json` (recorded in CHANGELOG at the v0.1 tag, per §4).
- Land a CI-green PR on `main` (§8 acceptance) and tag v0.1.

§8's ci.yml step enumeration (L153: install/typecheck/test/build) is now narrower than what ci.yml will actually run once this entry ships (+smoke +attw). Not a blocker and not parked — the work is unambiguous and human-directed; flagged in the commit body as spec hygiene the human may fold into §8.

Open questions: 0.

Trunk: `pnpm tsc --noEmit` clean; `pnpm test` green (7 suites, 68 tests); `pnpm build` succeeds with clean `.d.ts` specifiers. No code changed since (only the inbox commit) — still green.

Plan continues: no
