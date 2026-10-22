# The human-owned corpus owes a pass: five sentences the tree has outrun, two facts with no home

`spec/**` and `.claude/rules/**` are the human's lane, so no tick can land any
of this. Each item below was measured on the tree by the build tick that
shipped past it; nothing mechanical reads any of these sentences, so nothing
reds.

**Sentences the tree has outrun.**

1. `spec/chain.md`, *What a gate receives* — walks `entry` and `steps` as two
   bullets, and its `batch` bullet lists both per span. The type now carries
   one optional `assignment` (`{ entry, steps }`), withheld whole under a
   batch. Two bullets collapse to one; the `batch` bullet drops `entry,
   steps` for `assignment`. `docs/CHAIN-AUTHORING.md` moved with the type and
   its doc-walk pin holds that half.
2. `spec/chain.md`, *Supervisor policy is a chain-overridable default* —
   enumerates the policy block and does not name `gateTimeoutMs`, which ships
   in the declaration schema and is documented on the authoring page.
3. `spec/chain.md`, *Chain resolution is per-tick, and the tick is a fresh
   process* — "`tsImport` re-reads `chain.ts` and its dependency graph on
   every call — and the supervisor's mount-dead re-read leans on that".
   Measured, tsx 4.21 / node 24.21: the **entry** is re-transformed every
   call; the dependency subgraph keeps its first evaluation. So the lean is
   real but narrower, and the hole it leaves is parked as
   THE-MOUNT-DEAD-RE-READ-COVERS-A-BREAK-IN-WHAT-CHAIN-TS-IMPORTS, which
   cannot be written until this sentence says which half is the target.
4. `.claude/rules/platform-facts.md`, *A plain `import()` is pinned;
   `tsImport` re-reads* — same overstatement at the source: "and its
   dependency subgraph" is contradicted, and "sees the disk as it is now"
   holds only for a break in the entry module.
5. `spec/harness.md`, *Records as one file each* — the presence-is-state list
   illustrates with "a merging stake", which
   THE-INTERRUPTED-MERGE-MARKER-LEAVES-WITH-THE-REWIND retires. An example in
   a list, not a behavioral claim. The list may be worth leaving at three
   examples, or the operator may prefer a fourth that stays true (the tip
   claim; the candidate a dead run leaves for the startup sweep).

**Measured facts with no home on `platform-facts.md`.** Both are external, so
no test pins them and no type holds them — the page is the only home.

- **`execFile`/`exec` compose their own spawn options and forward no
  `stdio`.** Measured on node 22.20 and 24.21: the child always gets a stdin
  pipe however the call spells its options, so a `stdio: ["ignore", …]` on an
  `execFile` call is silently inert — and reads as correct at every site. The
  only seam is the promisified call's child: `p.child.stdin.end()`. One
  decision, two spellings.
- **`node -e <code>` parses later `--opts` as node options.** A fixture
  standing in for a tool, built as `process.execPath -e …`, exits 9 with `bad
  option: --reporter=json` before the script runs when a runner appends its
  reporter flags. End such a fixture's args with `--`. Consequence already in
  the tree: the pre-existing `["-e", ""]` no-report case refuses off node's
  parse rather than off the silence it names.
