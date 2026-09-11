# Barrel-pin comments cite line numbers that have already gone stale

Shipped both re-exports and both pins; tsc verified non-vacuous (dropping
either re-export yields TS2724/TS2305 on the pin import).

Debt observed while placing them: the two existing barrel-pin comments in
`tests/Dispatcher.test.ts` cite the line their import sits on — "(line 58,
from src/index.ts…)" at :14776 and "(line 65, …)" at :14799 — and both are
already wrong. The imports are at :81 and :88. Nothing re-reads them, so they
drifted silently as the file grew past 15k lines, and a reader chasing line
58 lands on unrelated code.

The class, not the two instances: a comment citing a line number in its own
file is narration nothing can check (`engineering.md`, *Narration is the
ladder's bottom rung*) — the symbol name already locates it. My two new pins
name the symbol and omit the number, so the file now carries both shapes.

Left the stale pair untouched: in fence, but not this entry's scope. Cheap
sweep-lens fix, or a one-line accepted-debt note.
