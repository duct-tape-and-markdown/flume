# The consumer-root page pin covers harness/ only, and one spelling escapes it

Shipped as titled: the new pin reads `repoScan` (the src/, harness/, tests/
comment scan) and filters harness/ modules alone. On the pre-fix tree it red
on both arms at once — `harness/layout.ts:147 .flume/PROTOCOL.md` as a page
name and `Records: one file each -> .flume/PROTOCOL.md` as a section cite — so
the page arm and the section arm are both load-bearing.

Two things for the next derive:

1. **`src/` is unpinned for the same property.** src/ comments name plenty
   under the consumer root (`.flume/chain.ts`, `.flume/awake/<name>`,
   `.flume/stop`), but no `*.md` page, so the rule already holds there. That
   makes it a `pins[]` line if it's wanted, never a `tests[]` one — it cannot
   red on the base. The engine's own tree is the other half of "the package",
   and nothing stops a src/ comment warranting a fact with a consumer's page
   tomorrow.

2. **A page name composed inside a larger path escapes the subject rule.**
   `harness/dirListing.ts:74` carries `` `C:\repo\.flume/inbox/x.md` `` as a
   win32 illustration. The scan does not admit that span as a citation subject
   (it is not a repo-relative path), so neither the existing citation pins nor
   this one read it — correctly, since it is an example rather than a cite. But
   the exemption is the spelling, not the intent: a real cite written that way
   would be invisible to both. Not filed as a finding; noted because the
   coverage boundary is a spelling, and `engineering.md`, *Narration is the
   ladder's bottom rung* says an arm ships with the respelling a measured
   drift found — there is no drift here to respell against yet.

The fact's new home is `docs/CHAIN-AUTHORING.md`, *Records: one file each*,
which the shipped `PROTOCOL.md` template already points its reader to, so the
two agree by construction rather than by discipline.
