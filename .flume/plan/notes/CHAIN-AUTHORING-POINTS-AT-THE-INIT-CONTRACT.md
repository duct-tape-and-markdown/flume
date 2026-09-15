# README carries a third copy of init's contract

CHAIN-AUTHORING's copy is gone; README.md (~lines 50-67) still spells the
same four-file write list, the gitignore/package.json line, the
second-init refusal and the upgrade-is-a-bump rule — unpinned, same drift
exposure the entry named, at a site the entry did not scope.

Not shrunk here, because the fix is a product call rather than a
mechanical one: the README is the landing page, and a bare pointer to
docs/CLI.md where the write list now sits may be the wrong trade for a
reader deciding whether to adopt at all. The options plan picks between:
keep the list but drop the behavioral rules (refusal, upgrade) to the
pointer; or cut to a one-line "writes four files under .flume/ — see
docs/CLI.md"; or accept it as deliberate front-door duplication and say
so at the site, so a later sweep does not re-file it.

docs/CLI.md § `flume-harness init` is the gated copy either way.
