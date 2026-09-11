# noUnusedLocals also rides the publish build

Shipped as written: the flag yielded exactly the five TS6133s the entry
predicted, all dead imports, and `pnpm tsc --noEmit` is green.

Scope the entry did not name: `tsconfig.build.json` **extends**
`./tsconfig.json`, so `noUnusedLocals` now also governs `pnpm build` —
i.e. `prepack`/`prepublishOnly`, the release-cut path. Verified green
(`pnpm build` clean over `src/**`), so nothing is blocked today. The
consequence worth knowing: a dead local in `src/` now fails a publish,
not just the tick gate. That is the desired rung, but it means the
refusal reaches a surface outside the build phase's gates.

Checked the three cut symbols for orphaned exports — `RUNTIME_IGNORES`,
`EX_TERMINAL_MISCONFIG`/`EX_MOUNT_DEAD` and `TickVerdict` all keep
consumers elsewhere, so no "export earns its consumer" residue follows.

`noUnusedParameters` left off per the entry; still clean today.
