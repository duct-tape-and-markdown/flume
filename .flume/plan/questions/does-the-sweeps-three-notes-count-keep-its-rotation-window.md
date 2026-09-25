# Does the sweep's "three notes files once" keep its rotation window?

The drain's copy of this bar is now unbounded, ruled at c684223f:
`spec/harness.md`, *The phases* reads "counted over every plan commit body,
unbounded, because the count self-terminates: a filed family stops being
re-noted, and a bounded window is how a family re-noted twice per window never
files."

Two sentences earlier the same section says "The drain files by the sweep's bar
(`.claude/rules/posture-sweep.md`, *Routing*)" — and *Routing* still reads
"accepted as debt in three plan commit bodies **of one rotation**", with "The
count is read off `git log` from the rotation's cursor, never estimated."

So the spec delegates the bar to a page and then overrides that page's window
for one of its two readers. The divergence is at least stated, but the argument
the spec gives against a window is not about the drain — it is about what a
window does to any recurrence count. The sweep's rotations close fast by design
(a quiet tree closes in one tick), so a family re-noted once per rotation across
five rotations never files, which is the failure the sentence names. `spec/` and
`.claude/rules/` are both yours; a build tick can touch neither.

**The fork**

- **(a) Drop the sweep's window too.** The self-termination argument transfers
  verbatim. Cost: the count stops being readable off the rotation's cursor and
  becomes a `git log` over every plan commit body — which is exactly what the
  drain does today, so the precedent is working rather than hypothetical. Also
  the cheapest: one phrase in *Routing*.
- **(b) Keep the window and declare why.** The sweep's coverage is
  cursor-bounded by construction, so a family recurring across rotations may be
  evidence the frontier re-armed rather than that the note was cheap. If that is
  the reading, the page should say so where the two bars diverge, rather than
  leaving a reader to discover that the section spec cites and the sentence spec
  states disagree.
- **(c) Give the bar one home.** Move it wholly into *Routing*, unbounded, and
  let `spec/harness.md` point rather than restate. Deepest fix and the one
  *Narration is the ladder's bottom rung* wants — but it collides with the
  caveat already ruled for the drain: `Slices.sweep.posturePages` is
  consumer-declared and required only when `plan-sweep` is enabled, so a
  consumer running the drain alone has no posture page to cite, which is why the
  drain prompt spells the bar at all
  (`harness/prompts/plan-inbox.md:62`). The sweep prompt does defer
  (`harness/prompts/plan-sweep.md:42`, "Findings route per the pages' own bar"),
  so (c) is available for the sweep half alone.

Whichever way it goes, the prompt-side copy is already queued:
THE-SWEEP-PROMPT-POINTS-AT-THE-PAGES-IT-RESTATES shrinks `plan-sweep.md:42`
to a pointer, so the page's wording is what a sweep tick will read either way.

Drained from build note `THE-DRAIN-PROMPTS-THREE-NOTES-COUNT-IS-UNBOUNDED`.
