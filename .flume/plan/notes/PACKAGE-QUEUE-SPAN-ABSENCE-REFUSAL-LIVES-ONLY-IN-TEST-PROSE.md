# The queue-absence refusal is pinned, but `spec/harness.md` never states it

Shipped: `tests/harnessPrompts.test.ts` pins that every plan slice prompt
refuses on an absent queue, and both refusal cases (wrong-kind on a guarded
span, absence on an unguarded one) now run through one driver keyed by the
ARTIFACTS table's `placeholder`.

Two things for the next plan tick:

- **Spec silence.** `spec/harness.md` says nothing about what a slice does
  when an artifact its span reads is missing — not the queue's refusal, not
  the two placeholders. The behavior is held by a pin and by prompt bytes;
  whether the package's contract should state it is the human's call
  (`spec/` is not build's lane). Candidate open question.
- **Declared divergence.** The example chain takes the opposite choice for
  the same artifact (an `[]` placeholder, `tests/examples.test.ts`). That is
  now named in the package test's doc comment as deliberate, so a sweep
  should not file it — but the naming lives on the package side only; the
  example's own span cites nothing.
