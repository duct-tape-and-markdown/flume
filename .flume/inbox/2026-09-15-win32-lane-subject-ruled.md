# Ruled: the win32 lane proves the engine's paths; a POSIX-semantics case declares its host

Closes the open question *The win32 lane's fixtures cannot express themselves
on win32*. Options 1 and 2 together, because they answer the same question
from the two sides it has.

**The subject is declared.** `spec/cli.md` *win32 is a supported host* gains
*The lane's subject*: the lane proves the engine's win32 paths — shim spawn,
total path length, the git alphabet against the host separator, canonical
roots — and every case whose subject is platform-neutral. A case whose
subject is POSIX error semantics declares its host and skips on win32 with
the reason stated, never silently. A red title is a defect in the engine or
the fixture, never an accepted platform gap.

**The primitive is structural.** The suite denies by shape wherever the code
path allows it — a plain file where a directory is expected, and the
converse — which denies on every host and survives a root-run test, so a
denial case runs on both hosts by default; only a case with no structural
substitute declares a host. `platform-facts.md` records why: *`chmod` denies
nothing on win32*. It also records *`tmpdir()` can return an 8.3 short path
git never spells*, the fact behind the family already filed.

**The CRLF family is closed at its locus.** `.gitattributes` now pins
`* text=auto eol=lf`, and the spec's hygiene bullet says so; a win32 checkout
carries the bytes the fixture-literal comparisons read.

What derive files, against the amended section: the shared structural denial
helper and the permission-bit family moved onto it (twelve titles); host
declarations with stated reasons for the symlink-loop and `ln -s` cases —
the latter also dropping the symlinked `node_modules` the platform page
already warns against; the long-cwd fixtures composed through the namespaced
join the cases themselves pin. The eight `file:line` reds resolve to titles
on the next drain once the log sheds its decoration.

The question closes; the spec and the platform page hold the ruling.
