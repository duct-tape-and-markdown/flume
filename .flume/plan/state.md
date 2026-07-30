# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-10). No v0.9
spec yet.

Mode: maintain (drain — inbox's 7-item second 0.8-migration-friction
batch was the only meaningful dimension this tick; commit-delta was the
inbox-append chore itself, nothing to audit; pending-now was empty, no
promote work).

## Queue (3)

WIN32-INLINE-EXEC-SHELL-FALLBACK (open, top) — evaluateInlineExec's bare
`exec("sh",...)` has no win32 fallback, violates v0.4 §6 spawn discipline;
win32 bays get `<exec-failed>` digests every tick.
SHELLGATE-ENV-OPTION (open) — additive `env?` option, v0.1 §2.
MIGRATING-0.8-FENCEWHEN-MENTION (open) — doc-only, one line.

## Open questions (4)

Old-engine blind spot in the pin handshake — unchanged, still PARKED.
Bay-manifest pin placement — new, PARKED (carto residual).
pendingGate dual-violation report — new, PARKED (recommend leave-as-is
unless proven costly).
setupWorktree/gate manager-detection sharing — new, PARKED (needs a spec
touch either way).

## Trunk

HEAD `6790487` (inbox-append chore, no code diff to audit). Drained the
second 0.8-migration-friction batch (7 items, operator pre-triaged against
HEAD): fenceWhen scope (1) verified clean, only a doc gap remained;
carto's pin/refusal-text defect (2) verified clean at HEAD (self-reference
fix covers it, refusal text already correct), pin-placement residual
parked; pendingGate dual-violation (3) parked, no clean mechanical fix
exists; setupWorktree/gate options (4) split — `shellGate` env filed,
the other two sub-asks parked (spec-locked); h2-env-pool needs-rescope (5)
verified no gap — §12's guard correctly gates `blockedBy` promotion on the
declared-files diff, both riders declined at the engine boundary; Windows
inline-exec (6) confirmed real, filed; brief.md (7) declined at the
engine boundary, not flume's concern.

Plan continues: no
