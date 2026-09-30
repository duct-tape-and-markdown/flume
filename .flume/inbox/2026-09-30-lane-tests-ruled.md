# Ruled: a host-gated case rides laneTests[], owed to its lane

*A win32-gated case cannot be named in an entry's tests or pins* — (b), as
its own field: `laneTests: [{ lane, title }]` on the harness entry
extension, keyed exactly as a CI lane keys its findings (`spec/harness.md`,
*The judges*). On the build host a `laneTests` line must report skipped,
never failed; the judge reports it `owed` to its lane and never green, so no
skipped case reads as proven (`engineering.md`, *A green verdict is proven
non-vacuous*). The lane closes it through the red-standing rule. The runner
reads the skipped status beside passed; the two win32 entries re-file their
cases under `laneTests`. Not (a), which the host-proof ruling rejects; not
(c), which claims bookkeeping; not (d).
