# Does the forest walk join the package's exports, or stay internal?

The shipped-tick note for `THE-ENGINE-WALKS-A-SUBTREE-AND-THE-CALLER-ORDERS-IT`
left this open on purpose: the entry collapsed two descents into one walk, and
widening the package's public surface was not in it. Routed here rather than to
the queue because the section that would rule it does not hold on the tree
(below), so any entry I filed would carry my reading rather than the section's.

## Measured on this tip

- `src/index.ts` names none of `subtreeOf`, `SubtreeEntry`, `isGoal`,
  `descendantsOf`; `FlumeApi` carries none of the three values.
- The `exports` map has two subpaths — `.` → `src/index.ts`, `./harness` →
  `harness/index.ts` — so nothing reaches `src/PendingSchema.ts` directly.
  `harness/goals.ts` imports the walk through the relative module path, which
  satisfies the export pin and reaches no consumer.
- `harness/index.ts` re-exports neither `standingGoals` nor `goalsBlock`, so
  the goals block is internal at that layer too. A downstream chain wanting a
  forest read, or a goal block of its own, rebuilds the descent today.
- `subtreeOf`'s doc comment says the depth is read there "rather than
  rebuilding the descent to recover it" and cites `engineering.md`, *A fact the
  engine holds is reported, never rediscovered* — naming a consumer that cannot
  reach it.

## Why the cite does not decide it

`spec/pending.md`, *What the package exports* says `src/index.ts` and
`FlumeApi` "are the canonical lists, and they carry the same values: every
pending-schema helper…". Both halves are false on the tree (read off the
namespace and a real `buildFlumeApi`):

- on `src/index.ts`, not `FlumeApi`: `Dispatcher`, `NO_COMMIT_MODES`,
  `PRIOR_ATTEMPT_MODES`, `consoleLogger`.
- on `FlumeApi`, not `src/index.ts`: `CjsContextLoadError`,
  `InlineExecRenderError`, `MissingPlaceholderRenderError`,
  `PendingParseFailure`, `PromptTemplateUnreadableError`, `RenderRefusal`,
  `TipClaimHeldError`, `git`, `paths`, `readGatedQueue`, `readPhaseTemplate`,
  `renderPrompt`.
- pending-schema helpers on neither: `isGoal`, `subtreeOf`, `descendantsOf`,
  `declaredPaths`, `entryFileName`, `entryTagFromFileName`,
  `entryExtensionPayload`, `CORE_ENTRY_FIELDS`, `DEFAULT_MAX_ENTRY_DEPTH`,
  `TAG_MAX_LENGTH`, `NAME_MAX`, `ENTRY_FILE_EXT`.

So "every pending-schema helper" names no decidable set, and no pin holds the
parity claim either — one would red on sixteen symbols today.

## Options

1. **Export the walk.** The three values on both lists, `SubtreeEntry` on
   `src/index.ts` (types are index-only by construction, as the section says).
   The doc comment stops promising an unreachable consumer. Cost: public API
   with no downstream consumer asking — `engineering.md`, *An export earns its
   consumer* wants a caller or a declared place in the surface, and scaffolding
   exports outlive their scaffold.
2. **Rule the forest package-internal**, and shrink the doc comment's consumer
   sentence to what it really serves: `harness/`. Consistent with both layers
   as they stand, since `standingGoals` and `goalsBlock` are internal too — a
   chain that wants goals adopts the harness package rather than rebuilding the
   block. Cost: a chain rendering its own queue has no forest read at all.
3. **Respell the section**, which the parity drift wants regardless: either
   name the pending-schema helpers the package exports, or state the rule by
   which one joins — "a helper a chain is expected to compose with" — so the
   next such question answers itself.

(2) and (3) compose; so do (1) and (3). What I cannot pick: whether flume's
public surface grows on a stated need or only on a measured consumer.
