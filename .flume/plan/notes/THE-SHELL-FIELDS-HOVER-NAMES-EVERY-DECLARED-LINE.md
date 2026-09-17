# The gate-only reading sat on two hovers, not one

`DEFAULT_SHELL`'s own doc comment (`harness/declaration.ts`) opened "the
shell a declared command gate runs under" — the same narrowing as the
`shell` field the entry named, on the constant that field's hover links to.
Widened in the same commit: a reader following the `{@link}` would have
landed back on the gate-only reading the entry was retiring.

No other stranded `declaredGates.ts` cite for this fact. `gates.ts`'s cite
(header) names it for *constructing declared gates*, which that module does
own; `chain.ts`'s restore cite already points at `declaredShell.ts`.

Worth a sweep lens sometime: the citation pin resolves a token against
disk, so a split that re-homes a job leaves every sibling hover naming the
old file green. Here the hover named a real file that no longer owned the
probe — exactly the class the pin cannot see, and only a reader notices.
