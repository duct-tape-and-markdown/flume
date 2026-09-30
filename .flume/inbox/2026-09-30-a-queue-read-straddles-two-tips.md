# A queue read lists at one tip and reads at another

Observed 2026-09-30T00:27:20Z, build wave, refill read. The tick exited 1:

    Command failed: git show HEAD:.flume/plan/pending/A-THROWN-PROMPTARGS-IS-A-RENDER-REFUSAL-AT-65.json
    fatal: path '...' does not exist in 'HEAD'

`readQueueAtRef` is called with the symbolic ref `"HEAD"`
(`src/pendingLedger.ts:404`), and each file's read (`readFileAtRef`,
`src/git.ts`) runs `ls-tree` then `show`, each resolving `HEAD` afresh. A
sibling plan-inbox tick dropped that entry and moved `HEAD` between the
listing and the show, so a path listed at one tip was read at the next. The
wave's verdict survived (it names the throw and the shipped entry), so the
cost was the rest of the wave, not its record.

`spec/pending.md`, *Dispatch reads come from the tip, not the tree*: a
dispatch read resolves the queue from the committed tip. One read, one tip:
resolve `HEAD` to a sha once per read and list and show at that sha, so a
concurrent commit is the next read's, never half of this one. Mechanical;
the fix ships a test that moves `HEAD` between the listing and a file read
and asserts the read returns the first tip's queue whole. Likely wider than
the queue: any engine read composing `HEAD:` across more than one git call
has the same shape.
