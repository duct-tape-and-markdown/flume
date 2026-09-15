# Two titles whose judged set is narrower than they read

Shipped as declared; both `tests[]` red on the base, both `pins[]` green.
Two shape notes for the next derive.

1. "every plan slice prompt refuses when its **plan state** artifact is a
   directory" — only plan-derive and plan-sweep span `PLAN_STATE_PATH`;
   plan-inbox does not. The body renders all three and asserts per-slice
   what its own spans entail (opens → refuses; does not open → resolves),
   with a `refused > 0` pin, so the roster is exercised whole. Still, a
   reader of the title alone would expect three refusals
   (`engineering.md`, *A green verdict is proven non-vacuous*, last bullet).

2. The cold-root pin cannot use a *fully* cold root: the `PENDING_PATH`
   span is a bare `cat` with no placeholder, so an absent queue refuses the
   whole render and nothing else gets to render. The pin seeds the queue
   only. That asymmetry is deliberate in the prompts (a slice with no queue
   is not a tick to proceed with) but it is undeclared anywhere — the
   package states it only by the absence of a guard.
