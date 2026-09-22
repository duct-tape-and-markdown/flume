# The three bullet reads disagreed on where a bullet ends

Folded onto `bulletOf` (`tests/helpers/docSections.ts`). The terminator is
derived from the lead the caller passes — marker through the name's own
delimiter — which reproduces both local spellings exactly (`^- **` + backtick,
`^- ` + backtick) and narrows the shellGate site's `\n-\s`. Verified before
the fold: all 20 bullets the three sites can read come back byte-identical.

Two things plan may want:

- `bulletOf` throws on an absent lead where `sectionOf` yields "". Deliberate,
  cited at the site: the caller's next act asserts what the bullet *says*, so
  an empty span would red as "silent on its class" over a bullet that is not
  on the page at all.
- *Use the built-ins first* carries one unbackticked bullet ("Each of those
  three doubles as its own factory:"). `walkOf` does not see it and the
  lead-shaped terminator does not stop at it, so a read of a non-final bullet
  in that section would swallow it. Harmless today — only the last bullet
  (`shellGate`) is read there — but it bites the first case that reads
  `eslintGate`'s.
