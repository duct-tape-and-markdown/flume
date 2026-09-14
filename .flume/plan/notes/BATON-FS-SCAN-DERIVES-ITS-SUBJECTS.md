# The derived fs scan now claims every named node:fs import is a path call

Shipped as filed: `tests/Baton.test.ts`'s win32 scan reads its subjects from
`src/Baton.ts`'s own `node:fs` and `./fsProbe.js` import clauses.

One judgment call, worth plan's eye: the derivation treats *every* value
symbol in those clauses as an fs call that must sit on `namespacedJoin(...)`.
True of Baton.ts today, but a future non-path import from `node:fs`
(`constants`, a promises namespace) would fail the scan for the wrong reason
— "imported but never called", or a bare argument that was never a path.
Type-only clauses are already dropped. I took the loud reading over an
allowlist, since an allowlist restates the literal array this entry deleted.
If that false positive fires, narrow the subjects by *call shape* (a symbol
whose first argument Baton.ts joins), never by re-introducing a list.
