# Field: a plan commit touching one claimed entry is refused whole

Downstream report, 0.19, item 6. Priority 30. With a wide wave the drain
folds notes into entries build still carries, and `pendingGate` refuses the
entire commit: six times in two runs, until the consumer added a pre-commit
script restoring claimed entries. 0.20 keeps the drain off a claimed entry's
notes, but the entry file itself can still be edited, and one such edit
costs every other routing the tick did.

The claimed set is on the prompt already. Two shapes to weigh: the drain
prompt says a claimed entry is read-only (prose), or the gate's refusal
names the file so the retry drops only that edit. Route to an entry if
*Claims — an entry in flight is left alone* already rules the shape.
