# The resolution has one home; two spec lines now contradict it

The two render sites no longer spell the rule: both read
`phasePromptPath(configDir, promptPath)` from `src/paths.ts`, beside
`chainModulePath` in that file's config-dir-layout section. A third caller
(the harness prompt factory, HARNESS-PROMPTS) gets the address rule for free
rather than re-deriving it.

Newly stale, and the human's to fix: `spec/cli.md:152` ("`phase.promptPath`
joins it") and `spec/jobs.md:95` ("`join(configDir, phase.promptPath)`") now
describe behavior the engine no longer has. Before this commit they merely
duplicated `spec/chain.md`; now they disagree with it. Worth an
open-questions line so the next interactive session edits both.
