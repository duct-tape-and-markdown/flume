# The quoted path was half the porcelain defect

`-z` fixes the quoting, and it also changes the record grammar: a rename or
copy spends a **second NUL-separated field** on the path it came from, and
that field carries no `XY ` prefix. Read as a status line it becomes a
phantom refusal naming a mangled path. The gate now consumes it, pinned by
*the clean-tree gate reads a rename's origin field as its origin, not as a
second status line* (`tests/harnessGates.test.ts`) — extra to the entry's
`tests[]`, because the `i += 1` branch is otherwise unverified logic inside a
gate that decides whether a tick's work survives.

Checked for a sibling to share the fix with (`engineering.md`, *The fix lands
at the mechanism*): `src/job.ts` is the only other `git status --porcelain`
reader, and it tests the output for emptiness alone — it never slices a path
out, so quoting cannot reach it. Nothing to generalize; no entry filed.
