# A root-level dotfile is out of the filename arm by construction

Sharing the path arm's filename detection with the slashless arm needed one
judgment call the entry did not name. Slashless, a leading dot is two
spellings at once: a root-level dotfile (`.env.example`) and a member access
whose receiver the prose elided (`.element.shape`; `.message`/`.failures` at
`src/Prompt.ts:567`). Nothing in the spelling tells them apart, so the arm
refuses the shape — which is what keeps `.element.shape` refused as the entry
required, at the cost of leaving a root-level dotfile cite unjudged. A dotfile
under a directory is unambiguous and still judged on its slash
(`.flume/loop.pid`). No `src/` or `harness/` comment cites a root-level
dotfile with an extension today, so the gap is empty; if one appears, the fix
is a spelling the scan can tell apart, not a list.

The widened rule surfaced 18 spans, all real pages: `engine-boundary.md` x17
and `platform-facts.md` x1, each repaired to `.claude/rules/<page>.md`.
`tick-verdicts.jsonl`, `package-lock.json` and `pnpm-lock.yaml` were newly
judged and already resolve. EXTERNAL_VOCABULARY needed no new entry.
