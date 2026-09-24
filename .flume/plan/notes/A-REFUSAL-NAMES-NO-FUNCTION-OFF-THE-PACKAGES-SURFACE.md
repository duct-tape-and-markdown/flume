# The literal arm stops at src/, and two classes stay open behind it

The scan (`tests/helpers/literalSymbols.ts`) takes its trees as a request
field; the live pin reads `src/` alone because that is what the entry's
`tests[]` line names. Measured with `trees: ["src/", "harness/"]`: the judged
set roughly doubles — 18 sites to 50, picking up `scriptRunner`,
`vitestRunner`, `harnessChain`, `supervisorPolicy` — and the findings are the
same five. So the harness tree is clean under this rule today, and widening
the domain is a one-line request change plus a second `it` with its own title
(the first cannot carry it: a title naming `src/` is the claim its body
asserts).

Two classes the arm does not reach, each a plan entry rather than a question:

- **A class name.** The span rule reads a camel hump behind a lowercase head,
  so `Dispatcher` in a literal is unjudged. Admitting a leading capital would
  read every sentence's first word as a symbol; the resolver would have to be
  narrower than the surface to pay for itself.
- **A member spelled without its receiver.** `writablePaths` resolves as a
  surface member wherever it appears, so a message naming a member that
  *moved* between interfaces still resolves. The page arm has the same hole
  (dotted spans, per THE-INTERFACE-PAGES-NAME-SURFACE-THE-PACKAGE-HOLDS).

One divergence left standing: `tests/PendingSchema.test.ts` keeps a stricter
local rule for the async-validator refusal — no engine declaration of *any*
kind, where the general arm permits a name the surface hands out. Its doc
comment now says so on its own terms. If plan wants one rule, that local test
is the thing to retire, not the general one to tighten.
