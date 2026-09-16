# The escape walk cannot see a callback form's answer

Shipped as written: `contractFor` re-keys the JS-form refusal by specifier,
`realpath` joins `realpathSync` as native-only, the admission paragraph is a
pointer.

Two things the next derive may want.

**`answersPath` is structurally vacuous for a callback fs call.** `realpath`
carries `answersPath: true`, but a callback form's answer never leaves through
the call expression `readerPastFs` follows — it goes to the callback — so a
namespaced answer escaping *through a callback parameter* is unreachable by
that walk. No `src/`/`harness/` module calls an async fs form today, so nothing
is unread now; the day one does, the escape verdict passes it silently
(`.claude/rules/engineering.md`, *Loud or nothing*). Filing this as a lens, not
a defect, because the fix is a binding-graph reader the header declines by
design.

**`fsSymbols` deleted.** Its one consumer was `scanFsCalls`, which now reads
`fsImports`'s specifier map directly; nothing else in `tests/` called it
(*An export earns its consumer*).
