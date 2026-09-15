# Expired narration in the example-prompts describe header

Shipped as written. One neighbour observation while widening the pin:

`tests/examples.test.ts`, the `examples/prompts — the spans read the
injected state root` describe header (:219-238) still states, present
tense, "the plan template's spans carry `|| echo` fallbacks: a miss
renders as '(none)' and the tick plans blind instead of refusing". That
defect is fixed — every artifact span now guards on `test -e ... || {
echo ...; exit 0; }`, so absence is selected explicitly and a failed
read reaches the renderer; the cases at :686 and :726 pin both sides of
that fork. The sentence reads as a live indictment of the shipped
templates and is not one. *Expired narration* lens
(`.claude/rules/posture-sweep.md`); shape-only, not correctness-
adjacent, so likely an accepted-debt line rather than an entry.

Also: `allSpans` is now derived from a new `sources` read (`{file,
text}` per shipped template) rather than reading each file itself — a
later pin whose subject is the whole template reads `sources`.
