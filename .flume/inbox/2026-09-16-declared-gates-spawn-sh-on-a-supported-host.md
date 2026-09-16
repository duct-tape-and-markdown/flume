# Declared shell and script gates spawn `sh` on a host where it may not resolve (consumer adoption answers)

`declaredGates.ts:89` builds every declared shell and script gate as
`sh -c <command>`. On win32 `sh` resolves only when git's `usr/bin` is on the
machine PATH. A 0.16.1 consumer confirmed it resolves for its ticks and also
that every one of those ticks was launched from git-bash; from PowerShell or
a service account it is unverified and, by that consumer's own note, not to
be assumed.

Why it matters: spec/cli.md rules win32 a supported host, and the package's
one shell is chosen by the package, not declared. A gate that cannot spawn
fails a tick for a reason the declaration never named, and the consumer's
remedy — launch from one shell by rule — is a convention the package would be
imposing without saying so.

The fork: the package probes and refuses at chain load, naming the gate; or
the shell becomes a declared value with `sh` as the default.
