# The unresolvable-cursor refusal is now a spelling, not a leg

The fix landed by generalizing rather than copying: `unresolvedCursor` in
`harness/cursorWindow.ts` took a `CursorField` and derived its state file from
`cursorSlice`, which is exactly what kept the sweep's second position out of
it. It is now `unresolvedCursorRefusal(name, cursor, stateFile)` — exported,
with both the name and the file as values — so the retired-claim cursor
refuses in the same words without `retiredThrough` entering `CURSORS` and thus
the derive's path. Any further position inside a slice's state file that is
read past rather than drawn past gets the refusal for the cost of a probe;
leaning on `bounded` instead is what produced this entry.

Observed while reading: `retiredThrough` is absent from `CURSORS` by
construction — `CursorFieldsOf` selects `PlanStateOf<S>[K] extends string`,
and the field is `objectName.optional()`, so it never reaches
`AnyCursorField`. That is the right answer for a cursor no window is drawn
past, but it means the table's exhaustiveness typecheck says nothing about it:
a third slice adding an optional cursor gets no table failure either. Its
monotonic rule rides `SLICE_STATE_RULES` (`harness/planState.ts`), which is
where the coverage actually is. Not filed — nothing is wrong today — but if a
second optional cursor ever appears, the pin worth having is that every
state-file field holding an object name is named by one of the two tables.

No spec or posture-page reading was needed beyond the entry's own cite; the
note's fork was answered on the tree exactly as the entry predicted.
