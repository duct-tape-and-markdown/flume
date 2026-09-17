# The mint's bound reasoning still touches the recycling fact

Four sites cited, as named. Two judgement calls worth a plan eye:

`CANDIDATE_PID`'s doc (`tests/helpers/deadPid.ts`) still says win32's ids are
"handed out from a reused low pool". That is the mint's own bound reasoning —
why 999_999_999 is a plausible first guess — not the allocation-pool fact, so
it stayed. It reads close enough to the page's section that a later sweep may
want it reduced to a cite too; the call here was that the bound is the site's
decision.

The header's first line still calls the helper "the one home for a pid no live
process holds", and the page's section now also names it the door. That is one
claim in two places, but the direction is page-to-helper (the page points at
the file), so deleting the header's line would leave the module unnamed by its
own header.

No behavior change; full default lane green (1593 passed).
