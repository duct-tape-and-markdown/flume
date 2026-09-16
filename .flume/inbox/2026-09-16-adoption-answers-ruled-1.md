# Ruled: a queue's writer runs over a corrupt queue; a script source is stamped; a question leaves by being answered (consumer adoption answers, relayed)

Closes three of the five records filed at e5632e4b.

- *A schema-violating queue blocks the tick that would repair it*:
  `spec/pending.md` *Queue reads are strict* — a phase whose declared
  writable paths include the queue runs over an unparseable one with the
  parse failure as a tick fact; a phase that cannot write it is refused.
  Keyed on a declared fence, not an inferred intent. `spec/loop.md`'s "until
  a human fixes it" now points there. What derives: the engine leg, and the
  plan slices reading the failure as input.
- *A declared script source re-emits a standing set every tick*:
  *Declared findings sources* — the slice stamps the set of names it drained
  and re-files only what it has not seen; the delta is the package's.
- *A question re-filed loses its ruling*: *Records as one file each* — a
  question leaves by being answered; the closing record and the page it
  changed hold the ruling, never the question. Nothing derives.
