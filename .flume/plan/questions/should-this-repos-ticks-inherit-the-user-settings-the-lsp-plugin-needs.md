# Should this repo's ticks inherit user settings, given the LSP plugin resolves through user state?

A tick now loads project settings only, unless the chain declares otherwise.
Measured against the installed `claude`: `--setting-sources` takes a
comma-separated list of `user, project, local`, so `project` alone also drops
`.claude/settings.local.json` — consistent with the spec's reason (a gitignored
local file is input the repository cannot see either), but `spec/chain.md`,
*Per-phase agent assignment* names only the user's own instructions, rules, hooks
and settings, so that third source is unspelled. Worth a clause whichever way the
rest goes.

**The live risk is this repo's own.** `.claude/settings.json` enables
`typescript-lsp@claude-plugins-official`, but the marketplace that name resolves
through is user state (`~/.claude/plugins/known_marketplaces.json`). Under
project-only settings a tick may lose the LSP tools that
`.claude/rules/code-navigation.md` points it at and that
`.claude/rules/engineering.md`, *An export earns its consumer* **requires** for an
absence verdict — a sweep tick that cannot resolve references is supposed to leave
the finding unmade and say so, and the failure here is silent: the tool is simply
absent. Unverified — proving it needs a real tick to report which tools it had.

`.flume/declaration.ts` is outside build's fence, so no autonomous tick can set
this either way; it is an interactive edit.

- **(a) Leave project-only.** Hermetic and reproducible; a tick's instructions are
  exactly what the repository holds. Accepts that absence verdicts stay unmade
  until a host-level check says the plugin resolved.
- **(b) Declare inheritance for this repo.** The sweep and build ticks get the
  instrument the rules assume. Costs reproducibility: a tick's behavior then
  depends on one machine's `~/.claude`, which is the thing
  `.claude/rules/memory.md` exists to keep out of the loop.
- **(c) Keep project-only and make the dependency loud.** A tick that needs an
  absence verdict and has no reference-resolver says so where it is read — which
  is what the rule already asks for, so this is a prompt/judge question rather
  than a settings one.

I lean **(c) plus (a)**: inheriting user state to get a tool back trades a
reproducibility property for a convenience, and the rule already names the
honest fallback. But the first thing worth knowing is whether the plugin actually
drops — one real tick's tool list answers it.
