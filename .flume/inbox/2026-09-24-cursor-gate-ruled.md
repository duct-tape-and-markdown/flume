# Ruled: the cursor gate holds every declared cursor

Answers `questions/the-cursor-gate-holds-one-of-two-cursors.md`: fork 1.
`spec/harness.md`, *The gates the discipline needs* now says a plan commit's
cursors — derive's and sweep's — each step forward over history the commit
reaches (this ruling's commit). The gate walks `CursorField` and keys on
each cursor's own slice file. Per *The fix lands at the mechanism*: file it.
