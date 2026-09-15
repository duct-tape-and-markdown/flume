# The same fallback still ships in `harness/prompts`

Shipped as written: build's `per` span refuses bare; plan's four guard with
`test -e` (placeholder + `exit 0`) and read past the guard, so a wrong-kind
path in place refuses. Out of scope, same defect:

- `harness/prompts/plan-derive.md:12`, `plan-sweep.md:8` —
  `cat "{{PLAN_STATE_PATH}}" 2>/dev/null || echo "(no plan state yet)"`.
  Identical fork (absent on tick one is legitimate; unreadable is not), and
  this is *this repo's own* loop, not an example. The guard transfers
  verbatim.
- `docs/CHAIN-AUTHORING.md` quoted the pending span verbatim; I updated it by
  hand. Nothing pins a doc snippet against the template it quotes — a second
  copy of one truth (`engineering.md`, *Derived state is computed*).
- `tests/examples.test.ts` ARTIFACTS keyed the inbox on detector `"inbox/"`,
  matching only because the old span spelled `ls .../inbox/*.md`. The
  read-through loop drops an artifact whose detector misses and `continue`s
  only when *all* miss, so the rewrite would have dropped inbox coverage
  green. Narrowed to `"inbox"`.
