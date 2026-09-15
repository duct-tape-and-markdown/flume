# The vacuity guard runs `sh` once, deliberately

The new pin in tests/harnessBuildArgs.test.ts renders the same real args
through two phases: the declared one (span inert) and one declaring no data
keys (span runs). The second half is the non-vacuity guard — without it, "no
`sh` output in the rendered prompt" would pass over a fixture whose span was
never executable. The command is `printf %s%s SPAN RAN`: no writes, no
network, in the repo root the render already uses for the prompt's own
`git log` spans. Flagging the call rather than deciding it quietly — if the
standard is "this suite never executes a fixture's span", the guard needs a
different shape, and the only one I see asserts the engine's break marker
(U+200B), pinning the renderer's internal spelling from a test file instead
of observable behavior.

Also observed: `spec/harness.md` carries no inline-exec span today, so the
hazard the entry named was latent, not live. Nothing stops one landing there;
the pin is now what catches it.
