# The loose-file refusal admits a top-level `.d.ts`, by the classifier it shares

The refusal reuses `emitsAModule` (`scripts/pack-harness-assets.mjs`), which
excludes `*.d.ts` on purpose: a declaration file is input only, so it leaves a
directory holding it copyable. Read the other way, at the top level of the
harness source, that same exclusion makes a hand-authored `harness/foo.d.ts`
refuse: `tsc` copies no declaration file into the emit and this step carries
directories only, so nothing writes it — which is the entry's stated rule
("neither a module `tsc` emits nor a directory the copy can carry") and is,
on the facts, the true disposition rather than a false alarm. Worth plan
seeing because one predicate now answers two questions with opposite senses,
and a later change that teaches the directory arm to tolerate some new
extension silently widens the top-level arm too.

Ordering changed with the loop: the `assetDirs.length === 0` refusal now runs
after classification rather than before it, so a source tree holding a loose
file and no asset directory names the loose file. Both are refusals before
any write, so no case swapped a green for a red.

`harness/` holds nothing but modules and `prompts/`, `templates/` today, so
this hole was latent exactly as the directory-carrying-a-module one is; the
new case authors the source tree the same way its sibling does, over the real
writer and the build's own emit.
