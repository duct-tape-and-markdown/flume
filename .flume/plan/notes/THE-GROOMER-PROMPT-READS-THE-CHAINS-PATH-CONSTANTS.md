# The groomer's runtime strings still spell the paths the prompt now renders

Shipped as written: the template names both artifacts through
`{{BACKLOG_PATH}}` / `{{SHIPPED_PATH}}`, `promptArgs()` supplies them beside
the schema block, and the new case reads the literals off the phase's real
`writablePaths` rather than spelling them, so the fence and the prompt are one
home. Red on the base at the `not.toContain`, green after.

One step past the entry's `files`: `groom.description`
(`examples/backlog-groomer-chain.ts:308`) spelled `BACKLOG.json` three lines
under the constant and is now a template literal off `BACKLOG_PATH` — a
reader who saw the prompt fold and not that one gets a mixed signal from a
didactic file.

Observed, not built — for plan to weigh, not a finding I hold: the same file
still spells both names in five *runtime* strings a consumer reads — the gate's
identity (`"BACKLOG.json parses"`, `:273`), its three verdict messages
(`:281`, `:287`, `:292`), and the agent's ENOENT line (`:203`) plus its parse
stderr (`:211`). Each is a second copy of a value the chain holds, so the
`per` section reaches them; each also sits within 250 lines of the constant in
the same file, and the gate's name is an identity a consumer's own tests may
key on, which the prompt's literals never were. My read is that this is debt
rather than an entry: no surface outside the file can drift against it. The
doc comments naming `BACKLOG.json` are prose about the artifact and are not in
that set.
