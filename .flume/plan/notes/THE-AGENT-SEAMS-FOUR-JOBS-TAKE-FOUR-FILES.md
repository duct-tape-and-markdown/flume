# The four jobs split; the test file took a fifth

Four src files where the dividers stood: `src/Agent.ts` (seam only, 162
lines), `src/claudeCode.ts`, `src/sessionCapture.ts`,
`src/terminalRender.ts`. Exported surface and `src/index.ts` names
unchanged; `extractResultUsage` moved with the renderer, `extractFinalMessage`
with the provider.

Two things plan should know.

**The old test file held a fifth job.** `tests/Agent.test.ts` carried two
describes whose subject was `src/streamJson.ts`, not the seam — the shared
line parse and the event-type predicates — plus the two agreement gates that
close them (real provider transcript through the real renderer and the real
extraction). They had no home in any of the four, so they became
`tests/streamJson.test.ts`, which the tree had been missing. The rest went
to `tests/claudeCode.test.ts`, `tests/sessionCapture.test.ts`,
`tests/terminalRender.test.ts`. The spawn-mock fixture two of those needed is
now `tests/helpers/fakeAgentChild.ts` (each caller still installs its own
`vi.mock("node:child_process")` — the registry is per test module). Test
count unchanged at 1940 collected.

**The seam's doc comments now name their consumers.** `AgentResult.usage`,
`AgentResult.finalMessage` and the `Agent` interface each carry a pair citing
one of the three new files, because the facts they describe left. That is the
citation pin working, but it points the seam *down* at its implementations: a
fourth module (a second provider, another decorator) multiplies those cites
rather than replacing them. If the tree ever grows one, the shape to watch is
whether the seam's prose should name a module at all or just the job.

Not touched, and deliberately: `CHANGELOG.md` and
`docs/surveys/consumer-chains/consumer-a.md` still name `src/Agent.ts` with
old line numbers. Both name retired surface on purpose.
