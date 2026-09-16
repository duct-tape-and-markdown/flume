# Ruled: the tag push publishes; the cut stays hand-curated

Closes *The release publish is hand-run, and `spec/cli.md` ratifies that*
(open-questions, the board's oldest). Operator's ruling. `spec/cli.md`
*Versioning policy* now keeps the bump, curation, commit and tag human and
has the `v*` tag push publish: a CI job publishes under the repository's
`NPM_TOKEN` secret, skips when the version already resolves on the
registry, then installs the published tarball from the registry and runs
the shim. A tag the registry does not resolve after that is red on its
lane. CLAUDE.md's *Release cut* keeps the manual recipe as the fallback
only.

Operator's side, done: the `NPM_TOKEN` repo secret is set from the same
credential `.env` holds, verified live against the registry first.

What derives: the release workflow beside `ci.yml`, and
`scripts/smoke-install.mjs` taking a registry target beside its pack one.
The workflow's first live run is the 0.16.0 cut.
