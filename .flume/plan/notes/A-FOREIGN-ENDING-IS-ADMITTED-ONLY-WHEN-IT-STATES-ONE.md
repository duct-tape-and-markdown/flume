# A NaN exit code becomes the other arm's spelling in the record's JSON

Measured this tick while reddening the non-integer case on the pre-fix tree:
an admitted `{ exitCode: NaN }` reached `platformFailures` as `NaN` and the
prior-attempt record on disk as `{ exitCode: null }` — `JSON.stringify`
writes `NaN` as `null`. That is the *other* arm's discriminant with no
`signal` beside it, a shape `AgentEnding` (`src/Agent.ts`) forbids, and the
retry's block renders it "exited with code null".

`readAgentEnding` now refuses it on the abort path, which is this entry's
scope. The resolve path is untouched by design (the entry's own note: a
declared field is told, not guessed) — but `Agent.invoke` is chain code, so a
chain adapter that resolves `{ exitCode: NaN }` typechecks and still persists
`{ exitCode: null }` through the same serializer. Nothing between the adapter
and the record reads the value. If that is worth closing, the candidates are
a persist-time refusal on the ending the record writes, or narrowing
`AgentEnding`'s code arm at the seam the dispatcher reads results through —
the first is one site, the second is the type doing it.

Unmeasured, filed for the same reason: `src/claudeCode.ts`'s own `close`
handler builds its ending with `typeof signal === "string"` and `typeof
exitCode === "number"`, the same two loose arms. Node never emits a blank
signal or a fractional code there, so it is trusted-by-platform rather than
foreign — I did not change it, and did not want to widen this entry into the
provider.
