# The bare-call rendering blanks its string literals

**Twelve verdicts, not eight.** The entry named eight sites; acceptance says
"no live-tree findings verdict in these four files". Four more met that
predicate and adopted expectNoFindings too: the orphan-ledger-key verdict in
tests/hostDeclarations.test.ts, and the live-tree escape, unfollowed and
jsForm verdicts in tests/namespacedFsPaths.test.ts — each a scanTree("src") /
scanTree("harness") flatMap asserted toEqual([]).

**Two formatters had never printed.** formatSpawnCapSite
(tests/helpers/spawnCaps.ts) was used at exactly one site, the live-tree
verdict, so the fixture verdict beside it now asserts rendered sites rather
than deduped module names. describeBareCall
(tests/helpers/namespacedFsScan.ts) was worse: eleven call sites across two
files, every one toEqual([]) — the rendering behind the composition verdict
had never produced a line. A fixture over a bare join now prints one.

**The finding worth queueing.** That fixture exposed it: scanFsCalls builds
BareFsCall.argument by slicing the *masked* source, so a path expression
carrying string literals renders its segments as runs of spaces — argument 0
of readFileSync(join(root, "plan", "state.json")) reports as
join(root, "    ", "          "). The site is decidable from that one line
only when the segments happen to be identifiers; with literals a reverted
tick reads blanks and opens the file anyway, which is the failure this
rendering work exists to end. The fixture sidesteps it with identifier
segments and says so at the site.

The fix is at splitArguments (same module): it returns substrings of the
masked text, so the argument's real span is gone before bare.push sees it.
Returning spans and slicing the unmasked source at report time is the shape.
That changes the scan's own reporting, not any verdict, so it wants its own
entry rather than a widening of this one.
