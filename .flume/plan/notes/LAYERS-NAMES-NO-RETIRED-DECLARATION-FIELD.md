# The reverse field pin covers one walk, not the whole page

`docs/LAYERS.md` had `jobs` twice: a bullet in the Border 2 walk, and the
worked-example row crediting 167 lines to "the `jobs` field, before it
existed". The bullet is gone; the row keeps its line count and now credits
one declaration per checkout (`spec/harness.md`, *What a consumer declares*).

The new pin reads only the Border 2 bullet walk's leads — the span before each
bullet's em-dash. Three limits the next sweep may want to weigh:

- **Prose on the page is not pinned.** The worked-example row that named
  `jobs` sits in a table, outside the cut. No decidable rule separates "a
  backticked name asserting a declaration field" from `writablePaths`,
  `Chain`, or `sh` in running prose, so a page-wide reverse read is not
  available. A retired field re-entering LAYERS as prose still ships green.
- **`docs/CHAIN-AUTHORING.md` gets the forward direction only.** Its
  declaration list is running prose naming the engine-level `Chain` fields
  beside the declaration's, so "every name here is a field" is not a claim it
  makes. Its forward pin is unchanged.
- **Bullet bodies are unread by design.** `ci` and `friction` sit after the
  em-dash in the `setup, agents, supervisor` bullet, so the reverse pin never
  sees them; the forward pin does. A field the page demotes into a body stays
  named but stops being walked, and nothing reds.

`leadNamesOf` lives in `tests/helpers/docSections.ts` beside `walkOf`, which
filters to declared members and so is structurally blind to a retired one —
the reason this direction needed a second reader rather than a second call.
