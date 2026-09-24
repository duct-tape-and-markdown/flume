# Ruled: the cursor gate becomes the slice-state gate

Answers `questions/does-the-cursor-gate-hold-the-covered-set-too.md`: (a).
`spec/harness.md`, *The gates the discipline needs* now states a slice-state
gate — each slice's file moves only as its own invariants allow, read over
the file at base and commit: cursors forward, the stamp only at close, the
covered set only growing while open, the retired-claim cursor only over
lines the commit could have searched (this ruling's commit). The rules ride
the table beside each slice's accessors. File it; the gate's name moves.
