# The same literal was in the docs, and the template still spans a cut corpus

**docs/CHAIN-AUTHORING.md taught the footgun it forbids.** Its inline-exec
section's code fence read `cat .flume/plan/pending.json`, ~60 lines below its
own bullet saying a `{{KEY}}` in a span is shell text you must quote, and
~60 lines below "Hardcoding `.flume/` in a prompt" as the named anti-pattern.
Rooted and quoted here as part of this entry. Nothing pins it: the new
`examples/prompts — the spans read the injected state root` block reads
`examples/prompts/` only, and a doc code fence is prose held by its authors.
A third copy would ship green.

**The shipped plan template still spans a corpus nothing declares.** Its
`<active-specs>` / `<aligned-specs>` spans `find specs/active` and
`specs/_aligned` — the partition cut when cascade-chain.ts dropped its `spec`
phase (pinned at `the cascade example declares plan and build and no spec
phase`, which checks the fence, not the prompt). Both spans render empty for
any consumer copying the template. Expired narration in a shipped example.

cascade-chain.ts's `writablePaths` `.flume/` literals are untouched, per the
entry's park.
