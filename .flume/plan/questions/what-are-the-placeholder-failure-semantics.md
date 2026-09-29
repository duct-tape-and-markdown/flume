# What are a missing placeholder's semantics — `render-refused`, or a wall the tick may die on?

From the inbox record *a refilling build wave outlives the code it launched
with*, defect 1. `spec/prompt.md`, *The render pipeline* already states this as
a **Gap**: "a missing arg throws a plain `Error` that the dispatcher rethrows
(`Dispatcher` catches only `InlineExecRenderError`), so it escapes the tick
uncaught and leaves no record for the retry. The corpus never states the
intended placeholder-failure semantics."

Verified on the tree this tick: `substitutePlaceholders` (`src/Prompt.ts`)
throws a plain `Error` naming every missing key, and the render's catch in
`runAttempt` (`src/tickAttempt.ts`) rethrows anything that is not
`InlineExecRenderError`.

## What it cost

Field-measured, loop of 2026-09-28T22:59Z: `prompt references missing args:
PROTOCOL_LINE` out of a refilled slot's render killed a build wave that had
already landed ~58 entries, with no verdict row for any of them.

## The fork

1. **A render that does not resolve is `render-refused`, whatever refused it** —
   the arm `spec/chain.md`, *What a hook receives* already gives a thrown
   `promptArgs` ("the record is persisted as for any other render refusal").
   The entry's slot ends with a record the retry reads; the wave keeps its
   siblings. Symmetric with the inline-exec span.
2. **A missing placeholder is a chain/engine defect, not an entry's outcome** —
   loud by design, and the fix is that the tick dies *after* writing its
   verdict (this tick's entry
   THE-WAVES-VERDICT-SURVIVES-EVERY-SLOT-THROW, which holds either way).
3. **Both, split by blame** — a key the phase declared and `promptArgs` did not
   supply is `render-refused`; a template referencing a key no phase declares
   is the config defect and refuses the tick.

I lean 1: it is the classification the sibling failure already has, and nothing
downstream has to learn a new class. But which of these the corpus states is
yours — the gap is in `spec/`, and no autonomous phase can close it.
