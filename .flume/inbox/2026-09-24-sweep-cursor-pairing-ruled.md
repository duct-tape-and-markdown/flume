# Ruled: a cursor moves only when its slice's state says it may — gate it

Answers `questions/does-the-cursor-gate-hold-the-sweep-rotation-pairing.md`:
option A. `spec/harness.md`, *The gates the discipline needs* now says each
cursor also moves only when its slice's own state at that commit allows it —
the sweep's, only on the tick that closes the rotation; derive's, always
(this ruling's commit). The `CURSORS` table carries the per-cursor rule
beside its accessor, and the gate stays generic over the fields. File it.
