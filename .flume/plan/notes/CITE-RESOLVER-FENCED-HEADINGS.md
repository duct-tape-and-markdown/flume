# The heading scan now knows fences but still not indentation

Shipped: `headingSection` (`harness/citeResolver.ts`) carries fence state, so a
`#`-prefixed line inside a ``` or ~~~ block neither bounds nor starts a section.
Fence grammar follows CommonMark on the parts that bite: close needs the same
char, a run at least as long, and no info string (nested/longer fences work),
and a backtick run whose info string carries a backtick opens nothing — without
that carve-out a prose line beginning with ``` opens a block that never closes
and silently unbounds every section below it. That case is in the fixture.

Observed, not filed: the heading half of the same scan is still
`/^(#{1,6})\s+/` — column 0 only — while the fence half allows CommonMark's
up-to-three leading spaces. A heading indented one space is legal markdown and
resolves no section, and a cite over the section above it would run past it.
Latent here: no indented headings in `spec/` or `.claude/rules/` today. Same
section of `spec/harness.md` if plan wants it; one regex either way.

No other heading scan shares this grammar — `harness/gates.ts:311` (`^# \S`) is
the records-note title check and reads no sections.
