# Ruled: the drain's three-notes count is unbounded, and the spec says why

Answers `questions/the-drains-three-notes-counting-window.md`: (a).
`spec/harness.md`, *The phases* now says the count runs over every plan
commit body, unbounded, because it self-terminates — a filed family stops
being re-noted — and a bounded window is how a family re-noted twice per
window never files (this ruling's commit). File the prompt's pointer at
that sentence in place of its own window.
