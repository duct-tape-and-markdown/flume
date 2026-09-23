# Ruled: the two question files open at c3521a37

- *`spec/harness.md`, The judges does not state the base re-run or
  `base-red`* — applied in this commit, naming the footprint condition: a
  merged suite red only in files the span never touched is re-run at the
  base, and failing there too the judge refuses with `base-red` rather than
  blaming the span. Nothing to queue.
- *`docs/CLI.md` owes a phrasing convention that lives only in a test
  comment* — (3) and (2) together, one build entry: the range assertion's
  message names what the page owes (every code a section means as a code
  carries its own introducing verb), and `docs/CLI.md`'s own intro states
  the convention in one line, so an author reads it before the pin does.
  `docs/` is build's lane, so no human edit; the reader keeps its
  value-vs-code discrimination, and list continuation is declined.
