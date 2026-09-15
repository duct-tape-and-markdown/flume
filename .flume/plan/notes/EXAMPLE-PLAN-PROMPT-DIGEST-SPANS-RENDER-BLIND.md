# The `|| echo` placeholder spans are the same shape, still unscoped

Shipped as written: `<spec-corpus>` guards with `test -d` and refuses; `<tsc>`
lost its unreachable `|| true`. The new text scan (`tests/examples.test.ts`,
"no shipped example prompt span carries a || fallback behind a pipe...")
covers only the unreachable-fallback shape.

The *reachable* fallbacks are untouched and are the same *Loud or nothing*
defect one rung quieter — the fallback fires, and the tick proceeds over a
placeholder nothing downstream refuses on:

- `examples/prompts/build.md:14` — `cat "{{PER_PATH}}" 2>/dev/null || echo
  "(spec not found: ...)"`. A build tick whose `per` cite does not resolve is
  handed prose saying so and builds anyway. Worst of the set: the harness's
  own `per cites resolve` gate has no counterpart in the example chain.
- `examples/prompts/plan.md:4,8,12,16` — pending/state/questions/inbox. An
  absent artifact is legitimately empty on tick one, so these want a
  first-tick-vs-missing distinction, not a bare refusal. That is a design
  fork, not a mechanical fix.
