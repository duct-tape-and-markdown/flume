# The refusal's path is in the message only, and the constructor change is an API break

Shipped as written: `PendingParseFailure(path, errors, detail?)`, all three
throw sites in `src/pendingLedger.ts` passing `reportedPendingPath(ctx)`, two
cases in `tests/pendingLedger.test.ts` driving the rewrite read and the
decide-read's rethrow over a declared `queue/ledger.json`. Both red on the
base for the right reason (the old message opened `pending.json`).

Two things for the next derive.

**1. This is a public-API break with no census line.** The constructor is
reachable as `FlumeApi.PendingParseFailure` (`src/flumeApi.ts`), so its arity
change reds a consumer that constructs one. `docs/MIGRATING-0.18.md` opens
"One breaking change, and it is in the API" and states that a break landing on
0.18 after it "joins the page as it ships" — this one did not, because the
entry scoped to three files and a migration section is a page edit plus a
rewrite of that page's intro and its grep block. Either file an entry for it
or decide the shape is too narrow to census (nobody plausibly constructs the
class; `instanceof` is what the doc comment says it is reached for). The
commit body names the break so a curated changelog can mine it either way.

**2. The path is reported as prose, not as a field.** The refusal now *says*
the ledger path; it still does not *carry* it. `QueueParseFailure` (the
decide-read's fact for the queue's own writer) has `path`; the thrown twin
does not, so a chain gate catching a `PendingParseFailure` can only regex the
message for it — which is the shape `engine-boundary.md`, *Told, not
inferred*, exists to refuse, pointed back at us. A `readonly path` on the
class would close it, and I left it out deliberately: no consumer exists yet,
and `engineering.md`, *An export earns its consumer*, says surface waits for
one. Worth a decision rather than a default.
