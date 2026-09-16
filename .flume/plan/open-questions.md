# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## platform-facts is silent on node 22's throw over a namespaced drive root

**Status: NEEDS AMENDMENT**

`.claude/rules/platform-facts.md`, *`realpathSync` keeps the `\\?\` prefix only
where nothing resolved*, prescribes the idiom the CLI entry check was built on:
namespace the path for the fs call, fold the answer back with `plainPath`. The
page describes the JS `realpathSync` as always *answering*. On win32 under node
22 it does not — it **throws**, and the fold is never reached.

Measured by diffing node's own source (v22.x vs v24.x `lib/fs.js`), not run
here — the throw is win32-only and this host is linux:

- `realpathSync` lstats its root before walking: `base = splitRoot(p)`, and
  `splitRootRe` reads `\\?\C:\…`'s leading `\\` as a UNC root, yielding
  `\\?\C:\`.
- Node 22 passes that to the binding raw. The binding resolves away the
  trailing separator, `\\?\C:` names no file, and the call throws.
- Node 24 added `getRealpathRootLstatPath`, whose whole job is stripping
  `\\?\` off a drive root for that one probe. It is not in v22.x HEAD, and
  `package.json` `engines` still admits node 22.

So `realpathSync(toNamespacedPath(p))` is not a safe composition of the two
idioms this page ratifies — it is the shape that produced the windows lane's
standing junction red. `realpathSync.native` (already named on the page as
stripping the prefix unconditionally) does no root split and is the fix
`CLI-ENTRY-CHECK-RESOLVES-A-NAMESPACED-ROOT` carries.

**Why this is a page edit and not the entry's.** Build cannot write
`.claude/rules/**` (`.flume/declaration.ts` fence), and the page is the human's
(`.claude/rules/spec-plan-build.md`). Two doc comments cite this section as the
reason for their shape — `src/cli.ts` `onDiskIdentity` and `src/paths.ts`
`plainPath` — so a page that omits the throw sends the next author back to the
composition that broke. This already cost one round: the fold shipped, the call
still threw, the lane stayed red.

**Proposed amendment** — one paragraph appended to that section:

> Node's JS `realpathSync` additionally lstats the *root* it splits off its
> argument before walking, and on win32 reads `\\?\C:\…`'s leading `\\` as a
> UNC root; through node 22 it hands that root to the binding unstripped and
> throws on every namespaced path. Fixed in node 24, not backported, and
> `engines` admits 22. So a namespaced path goes to `realpathSync.native`,
> never the JS form — which also makes the answer's fold a no-op, leaving
> `plainPath` load-bearing on the throwing leg alone.

**Alternatives, if the ruling goes the other way:** raise `engines` to node 24
and bump both CI lanes (drops node 22 hosts for one call site), or stop
namespacing at the entry check (reintroduces win32 MAX_PATH on `argv[1]`, whose
depth is the installer's and unbounded by us — `spec/cli.md`, *win32 is a
supported host*, *Total path length*). Neither is recommended.

