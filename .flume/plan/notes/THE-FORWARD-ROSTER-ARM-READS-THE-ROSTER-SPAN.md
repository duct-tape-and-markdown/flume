# Both roster arms now read one span, and the cut moved into it

Shipped as written. The two arms over the gate roster in
`docs/CHAIN-AUTHORING.md` now share `rosteredGateNames()`
(`tests/harnessGates.test.ts`): it cuts the adoption section, cuts the
parenthetical out of it, and asserts both cuts plus `n > 0` names before
either direction reads them. `adoptionInventory()` is gone — it had no
caller left once the forward arm stopped reading the section whole.

Measured red-check of the acceptance, on this tip: dropping `slice-state`
from the roster while leaving a `` `slice-state` `` backtick elsewhere in
the same section reds the forward arm with "the set holds `slice-state`,
which the roster never names". The pre-change arm read that mutation green
by construction — `inventory.includes` over the whole section is satisfied
by the moved backtick.

One thing the next plan tick may want to weigh: the section-level anchor
(`expect(inventory).toContain("**The harness package**")`) is now partly
redundant against the roster anchor beneath it — a renamed heading yields
an empty section, so the `ROSTER` exec finds nothing and the
"spends no parenthetical" refusal fires anyway. I kept both because they
separate two failures a reader must tell apart (heading renamed vs. roster
reworded), and the entry asked for the cut to be asserted before it is
read. Not debt, just a judgment call made at the site.

No other case read either helper, so the narrowing touched nothing else.
