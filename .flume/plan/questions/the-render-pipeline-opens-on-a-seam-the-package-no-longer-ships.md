# `spec/prompt.md`, *The render pipeline* opens on a seam the package no longer ships

The section's first paragraph still describes the render as reading its own
file:

> `renderPrompt` reads the prompt file its caller resolved — `phase.promptPath`
> resolved against `configDir`, a relative path beneath it and an absolute one as
> given, passed as `RenderOptions.promptFile` — and applies four
> transformations in fixed order:

`RenderOptions.promptFile` is gone. `renderPrompt` takes `template: string` —
the bytes, never the address — and the read moved to `readPhaseTemplate`,
called once per tick beside the chain load. `spec/prompt.md:13-15` is the only
copy: `docs/` and the README carry none.

**How it got here.** `a0ca492b` rewrote this section's *placeholder* paragraph
and ruled, in `spec/loop.md`, *One tick is one fresh process*, that a tick
renders from the templates it loaded with its chain. The entry that ruling
armed — `A-TICK-RENDERS-THE-TEMPLATES-IT-LOADED-WITH`, shipped at `1a11240c` —
retired the field. The opening paragraph was never in that commit's diff, so
the spec ruled the behavior in one file and kept describing the old seam in
another.

**Why it is not just tidying.** `THE-PLACEHOLDER-REFUSAL-IS-A-RENDER-REFUSAL`
is in flight right now and cites `per: spec/prompt.md, The render pipeline`.
Its build agent reads this paragraph as the mechanics of the code it is
editing, and the paragraph names a field that file no longer has. The build
note this drained (`A-TICK-RENDERS-…`) predicted exactly this collision one
level down, in the entry's own text; the entry's text turned out clean and the
section it cites did not.

**The fork is which sentence the spec wants**, and both readings are live:

1. **The read is still spec'd here, relocated.** The resolution rule — relative
   beneath `configDir`, absolute as given — is real and still the package's;
   only its home moved. The paragraph names `readPhaseTemplate` as the loader
   and `renderPrompt` as taking the loaded bytes, and the "one load per tick"
   fact stays in `spec/loop.md` where it was ruled.
2. **The read leaves this page.** `spec/prompt.md`'s stated scope is "how that
   prompt is produced" from the template onward; the loading of the template is
   the loop's business, and the section opens on the four transformations with
   a pointer at `spec/loop.md`, *One tick is one fresh process*.

(1) keeps the resolution rule stated somewhere — no other section carries it,
so (2) drops it from the corpus unless `spec/loop.md` takes it. That is the
cost worth weighing.

**No third reading where the code moves.** The field was retired under a
ruling, not by drift.
