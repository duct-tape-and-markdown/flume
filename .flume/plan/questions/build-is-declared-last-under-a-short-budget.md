# Build is declared last, so a short budget starves the product

`spec/loop.md`, *Baton — presence wakes, absence hibernates*: "Declaration
order is the priority and the tiebreak." The package declares
`phases: [...planSlices, build]` (`harness/chain.ts`), so **build is last of
all**. With `supervisorPolicy.maxTicks` at the engine default of one, every
iteration where any plan window is live goes to a plan slice.

`.claude/rules/posture-sweep.md`, *The sweep runs beside build, never ahead of
it*, reasons only about order *among the plan slices* ("the sweep is declared
last among the plan slices"). Its **Why** is the opposite of what the composed
order delivers: "insurance scheduled ahead of the product inverts the loop's
economics." Today the yield rule is what protects build; dropping the yield
(the rule's new text) without raising the budget hands the single slot to plan
for as long as the sweep rotation stays open — a rotation only the sweep
closes.

This is why `EVERY-WINDOW-IS-LIVE-ON-ITS-OWN-WORK` is parked rather than open.

The fork:

- **Declare build first.** `phases: [build, ...planSlices]`. Priority then
  reads product-first and the sweep rule's tiebreak sentence stays true of the
  plan slices among themselves. One line in `harness/chain.ts`.
- **Raise this repo's budget and leave order alone.** `supervisor: { maxTicks:
  N }` in `.flume/declaration.ts` — outside every autonomous phase's fence, so
  the operator's edit either way. Correct for this repo; leaves every consumer
  on the default with the inversion intact.
- **Both**, treating the order as the package's floor and the budget as the
  consumer's throughput knob.

Bound on the budget: the declaration already caps fanout at
`maxParallel: 2` for OOM headroom on this host, and each build tick runs the
full suite. Whatever `maxTicks` becomes, the two bounds multiply.
