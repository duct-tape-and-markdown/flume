# The POSIX lane hand-rolls a near-copy of scripts/smoke-install.mjs

Shipped as written: ci.yml's "Consumer-install smoke" now closes on `check`,
and tests/bin.test.ts pins it against the script's `CHAIN_LOAD_VERB`.

Observed while doing it — the windows lane runs `pnpm run smoke:install`; the
ubuntu lane instead re-spells most of that script inline (pack, `npm init -y`,
`npm pkg set type=module`, `--no-save` install, the same chain.ts fixture, the
same prompt fixture, the same chain-load claim), in shell, with its own copy of
each rationale comment. That inline copy is why this entry existed at all: the
verb drifted on one side only, and nothing read the other. The agreement case
bounds the verb; the rest of the duplication is unbounded, and the next drift
lands in whichever line the case does not read.

The lane cannot simply call the script: the "Consumer type-resolution gate"
step reuses `$RUNNER_TEMP/flume-consumer` and the tarball this step leaves
behind, while the script packs into a temp dir it deletes. Closing it wants a
decision — have the script expose its consumer dir, or let CI keep its own.
Filing as observed debt, not a park.
