# Ruled: `flume-harness init` seeds each slice's state file at the adopting tip

PR #20 (merged) left one design question: whether the harness may seed plan
state when an effort adopts it. Ruled yes, narrowly. `init` writes each
slice's state file with its cursors at the commit the adopter runs it on and
a closed rotation — derive nothing before adoption, sweep nothing before it.
That is not the harness choosing a sha on the consumer's behalf: the
adopting tip is the consumer's own commit, and the alternative — a fresh
effort inventing the file's shape from prose — is the defect the PR fixed.
An adopter who wants history derived moves the cursor back by hand, once.
File it against `spec/harness.md`, *Adoption and upgrade*.
