# Ruled: the absence-verdict bar names the property, the host holds the tool, and the pin is queued

Closes the open question *The sweep's absence-verdict tool is not on this
host, so consumerless-export findings cannot be made*.

**The cause was the host, not the rule.** `typescript-language-server` was
installed globally — under nvm's node v24.13.1. The loop runs on v24.21.0,
whose global tree was empty, so the tool fell off PATH silently at the node
upgrade. Reinstalled under the active version this session; `LSP
findReferences` resolves again. The fact is recorded where host facts live:
`platform-facts.md`, *nvm scopes global packages to one node version*.

**The bar is restated as the property.** `engineering.md` *An export earns its
consumer* now asks for a search that resolves symbols, names LSP as the
instrument and the platform fact as its prerequisite, and says a host without
it leaves the verdict unmade rather than approximated. `posture-sweep.md` and
`code-navigation.md` say the same in their own words.

**The pin is queued, per the ladder.** The same bullet now names its own
promotion: a pin that fails on an export reachable from no entry of the
package's `exports` map and referenced from no other module. That is the
question's option 2, taken through the pipeline rather than by fiat — derive
reads the rule delta and files the trial (`knip`, `ts-prune`, or a scan over
the TypeScript program the suite already builds in `tests/helpers/`), and the
bullet shrinks to a pointer when it ships.

**Three findings were left unmade for want of the tool** and are now
makeable. Their neighborhoods are covered for this rotation, so the sweep will
not return to them; this record carries them so the draining tick can make
each verdict with the tool it now has, and file or discharge on what it finds:

- `tests/helpers/spawnBudget.ts` — `defaultLaneFiles`.
- `scripts/build-changelog.mjs` — `resolveLastRelease`, `deriveEntries`,
  `renderSection`; and the `isDirectInvocation` doc block that justifies
  itself by a consumer.
- `tests/helpers/waitFor.ts` — `WAIT_TIMEOUT_MS`, `WAIT_INTERVAL_MS`.

The question closes; the rule pages hold the ruling.
