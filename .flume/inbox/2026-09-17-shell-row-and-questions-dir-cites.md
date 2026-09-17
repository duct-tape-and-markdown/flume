# Ruled: the declared shell has its own row; the rule pages name the questions directory

Closes both files in `plan/questions/` at 9d23decb.

- *`spec/harness.md` states the declared shell's refusal on the `gates` row
  alone* — (a). A `shell` row now states the shell for every command line
  the declaration carries — a shell gate's, a script gate's,
  `setup.restore` — with its load-time refusal naming the site; the `gates`
  and `setup` rows point at it. Nothing derives: the tree already does this.
- *The rule pages and CLAUDE.md still name the deleted page* — done
  mechanically: CLAUDE.md, `spec-plan-build.md`, `collaboration.md`,
  `memory.md` and `engineering.md` name `.flume/plan/questions/`, one file
  per question, any session may add one; `engineering.md`'s example keeps
  its point. Nothing derives; these pages are outside every pin's domain,
  which is why the ask was a file.
