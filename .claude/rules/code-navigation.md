# Code Navigation

## Tools, in order of preference

When navigating or reasoning about code, pick the tool that gives the right level of structural understanding:

### 1. LSP — symbol level

Use for:
- Finding all references to a function, type, or variable across the codebase.
- Looking up a symbol's definition, signature, or surrounding scope.
- Inspecting what an interface or type exposes (members, params, return type).
- Spot-checking a single file's types without running the full `pnpm tsc`.

LSP catches type-level breakage *during* exploration, before the build phase's `tscGate` reverts the commit. Use it as part of the inner loop, not just as a final check.

Provided by the `typescript-lsp` plugin (already enabled in `.claude/settings.json`); requires `typescript-language-server` on PATH (globally installed).

### 2. ast-grep — structural pattern level

Use for:
- Code-shape searches that text grep can't express, e.g. `ast-grep -p 'phase.handoff($R)'` to find every handoff callsite regardless of variable naming.
- Audits that span the codebase, e.g. `ast-grep -p 'spawn($BIN, $ARGS, $OPTS)'` to verify every spawn passes options structurally rather than positionally.
- Multi-file pattern rewrites that LSP can't express as a single operation.

Globally available as `ast-grep` when installed. Pattern syntax: https://ast-grep.github.io/guide/pattern-syntax.html.

### 3. Grep / Glob / Read — text level

Use for:
- Prose, markdown, YAML, JSON.
- A single file you already know — LSP overhead exceeds value.
- Initial orientation of an unknown repo, e.g. `glob 'src/**/*.ts'` + `head`.

## When to skip LSP

The bar is: *would symbol-level understanding actually inform the next step?*

- Editing a `.md` / `.yml` / `.json` file — no TS symbols.
- Reading a specific known file end-to-end — Read suffices.
- Looking for a literal string (a comment, an error message) — grep is faster.

If you're navigating or modifying code and you'd lose information by treating it as text, reach for LSP first.
