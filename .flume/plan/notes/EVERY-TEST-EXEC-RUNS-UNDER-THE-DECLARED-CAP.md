# The wrapper count was 23, not 26 — the extra three were fixture strings

Measured by AST, `tests/` held 23 `promisify(execFile)` sites, not 26: the
entry's count included the two inside `tests/spawnCaps.test.ts`'s fixture
string literals, which are that scanner's own subject and must stay. That is
why the new scan parses rather than greps — a line needle flags those two and
the four prose mentions in `tests/git.test.ts`.

The scan landed as `scanPromisifiedSpawns` in `tests/helpers/spawnCaps.ts`
beside `scanSpawnCaps`, which already owned the capturing-API vocabulary. Not
`scanSpawnCaps` over a `tests/` domain: that reports 494 findings there —
`vi.mocked(execFile)`, `execFileSync` in mock-shape suites, fixture helpers —
because judging every call is the wrong question for a tree whose spawns are
partly subjects. Worth knowing if a later entry proposes widening the cap
scan's domain.

One adjacent pin re-homed in the same commit: TESTS-EXIT-STATUS-VIA-HELPER's
vacuity filter keyed its "files that spawn a child" subject on the literal
`execFile`, which this change deletes from 22 files. It now also counts files
importing the wrapper module.
