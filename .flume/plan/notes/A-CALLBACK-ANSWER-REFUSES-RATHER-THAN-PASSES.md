# The answer route, and a report with no live subject

Shipped as a third value on the contract rather than a fourth boolean:
`PathContract.answer` is `none | expression | callback`, so `readerPastFs`
stops on one condition instead of a special case, and `contractFor` re-keys
route and JS-form refusal together for `node:fs/promises` — both are the one
fact that the name reaches another implementation.

Two things for the next window:

- The tree-wide unfollowed case is empty-by-design and its only live subject
  is a fixture: no `src/` or `harness/` module imports an async `node:fs`
  form. It arms itself the day one does.
- `readerPastFs` looks a pass-through call's route up by name, not specifier,
  so a promises `realpath` met mid-walk stops it — conservative, declared and
  cited at the site. The nesting it declines to chase is already red at that
  call's own path argument, which reads as no composition. If that ever needs
  to be exact, the walk takes the bindings list instead of the name list; it
  was not worth an untested branch today.
