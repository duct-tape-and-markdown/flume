# Six more verb sections copy the shared root cause, unpinned

The shared state-root pin is scoped to the verbs whose `74` help row says the
shared refusals are its only ones — wake, sleep, stop, render — read off
`SHARED_ROOT_ONLY_LEAD` (`src/cliHelp.ts`) rather than listed. Every other
verb's row renders the same clause beside causes of its own, and those page
sections state it partially or not at all: status, tick and check carry one of
the three phrases, loop, log and friction none. Their help rows carry all
three. So six copies are still free to drift; pinning them means either
widening their page sentences to the whole shared cause (loop/log/friction
would gain prose they have never carried) or a weaker read. Plan's call.

Second: `sentencesNamingExitCode` (`tests/cliHelp.test.ts`) splits on a period
before an upper-case letter, backtick or paren, so a paragraph opening with a
bolded lead never starts a sentence — docs/CLI.md's `--phase <name>` paragraph
is glued to the tick section's exit-`0` sentence and reads as part of that
code's window. Harmless for this pin (the reads are containment, and the
discrimination arm is over the misses), but a per-code window can silently
reach past its own paragraph. Widening the reader would move standing pins that
assert set equality over their windows (LOOP-74-CAUSE-LIST-PINNED-PER-ARM,
CLI-DOC-CHECK-AND-STATUS-IO-REFUSALS-PINNED), so it was left alone here.

Third: the tick section stated its whole range as one semicolon-joined
sentence, which made every code's window the same text. It is now one sentence
per code, as the page's own banner already asks for. The same shape would pay
off in the loop and status sections, which still run several codes through one
sentence.
