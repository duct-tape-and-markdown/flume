# The unfenced wrap needed the comment's furniture named, not just its break

Detection is "a line's last token ends in `/`, the next line opens with a
`*.md` token". Two furniture shapes reach that predicate and are not wraps: a
block comment's closing ` */`, and an empty `//` line. Both are handled by
stripping furniture at *both* edges before the head token is read — a
`BLOCK_TERMINATOR` on the right beside the existing `CONTINUATION_MARGIN` on
the left. Neither is a special case for a literal; both are the same "markdown
renders no furniture" rule the margin already carried on one edge only.

Observed while measuring: `src/` and `harness/` carry no such wrap today, so
`broken` stayed empty and the repo wrap pin covers both fencings with no
rewrapping needed. The scan's `bare` count did not move either.

Left as-is, no entry filed: a wrap whose head is a *placeholder* directory
(`<area>/` + `notes.md`) is reported as `wrapped` but not `broken`, since
`closed` fails the path charset. That matches the fenced arm's verdict for the
same spelling, so it is agreement rather than a hole.
