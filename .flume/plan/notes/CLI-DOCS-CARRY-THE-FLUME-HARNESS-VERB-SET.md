# Two pages now state `flume-harness init`'s steps and refusals

docs/CHAIN-AUTHORING.md § "Adopting: `flume-harness init`" already walks what
init writes, that a range you pinned is left alone, and that an existing state
root refuses. docs/CLI.md now carries the same facts in per-verb contract form
(steps, refusals, exit codes) because that is what this entry asked for and what
the README's pointer promises. Two prose copies of one contract: the CLI page
owns it, and the authoring page's paragraph wants to shrink to a pointer.
Not filed as a defect here — which page owns the adoption walkthrough is a
docs-shape call, not mine mid-entry.

Second, scope of the new pin: the doc-vs-bin scan reads README.md and docs/**.md
only. A verb named in CHANGELOG.md, examples/, or a `src/`/`harness/` doc comment
is unread by it. CHANGELOG is deliberate (it records history, including verbs
that were renamed); examples/ is not — a sample chain naming a stale verb would
ship green.
