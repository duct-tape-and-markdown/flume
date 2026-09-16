# Ruled: the realpath fact covers the async forms; a cited home is pinnable

Closes both questions parked at f8f3d8e.

*Does the realpath platform fact cover node's async form?* Widened, after
reading node v22.x's `lib/fs.js` and `lib/internal/fs/promises.js`: the
callback `fs.realpath` is the same JS walk with the same win32 root probe,
handing the error to its callback; `realpath.native` and
`fs.promises.realpath` are the native binding. The section now says a
namespaced path goes to a native form, never a JS one. What derives: the
scan's async-`realpath` flag flips to refuse, as its site already names.

*Can a citation's named home be pinned?* Widened. `engineering.md`
*Narration is the ladder's bottom rung* now lets a pin resolve an
identifier paired with a path in the citation form `` `name` (`src/file.ts`) ``
in that file — where a declaration lives is the token's fact — and says a
bare path is context, no pair read into it, which keeps the one
false-positive site out. What derives: the comment-citation scan gains the
pair arm; CITATIONS-FOLLOW-THE-JOBS-THAT-MOVED ships its fixes under it.
