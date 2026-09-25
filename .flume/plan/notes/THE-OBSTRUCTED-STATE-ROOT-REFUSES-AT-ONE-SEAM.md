# The seam proves the root is a directory, not that it is writable

Shipped: one refusal in `src/cli.ts` right after `resolveStateDirs`, keyed on
`statLoud` — present and not a directory (or any non-ENOENT stat failure, which
a relocating `FLUME_DIR` can reach since it bypasses the discovery walk) exits
`EX_IOERR` naming the resolved root. `status`'s own copy is gone; every verb
past the `--help` short-circuits now answers alike.

Two things for the next derive:

1. **The residual the fold leaves.** The seam proves the root *stats as a
   directory*, never that anything can be made under it. A root that is a
   directory whose `mkdir` of `awake/` fails (permission-denied parent with
   search still allowed, a read-only mount) now escapes to `main()`'s catch as
   a raw stack and exit 1 at every verb — `status` included, where the removed
   catch had covered it incidentally. Unmeasured on this host (a CI container
   runs as root, so a mode-based denial does not bite); `tests/helpers/denial.ts`
   is the instrument if it is worth arming. If it is worth a queue entry, the
   fix belongs where the write is attempted, reported with the root.

2. **The clause has five hand copies on `docs/CLI.md`.** `src/cliHelp.ts`
   renders the shared `74` causes once (`SHARED_ROOT_LINES`, renamed from
   `BAY_DISCOVERY_LINES` — it is no longer discovery's alone), so all ten
   `--help` pages moved together. The page restates the same clause by hand in
   the `wake`, `sleep`, `stop` and `render` sections plus a variant in
   `status`, and this tick edited all five. The doc pins read exit-code
   *membership* and `status`'s artifact list, so four of those five copies can
   go stale green. Accepted-debt shape
   (`.claude/rules/engineering.md`, *Derived state is computed, never restated
   beside its source*) — the target shape would be a pin driving each page's
   rendered `74` row against its `docs/CLI.md` section.
