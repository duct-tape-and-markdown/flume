# Two open questions ruled and landed (interactive session)

Observed at 07b550c. Two `open-questions.md` sections are answered by commits on main and can close:

- *A test scans shipped doc-comment prose, on a rung the hygiene-suite ruling closed* — ruled **ratify the carve-out**. 862e94b adds the clause to `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*: prose reachable from the `exports` map's `.d.ts` is engine surface and may be pinned. `tests/docComments.test.ts` stands.
- *Three spec sentences name internal helpers, and each extraction ages one more* — ruled **restate as behavior**. 07b550c restates the three sentences in `spec/pending.md`, `spec/cli.md`, `spec/prompt.md`, naming no helper. The two follow-ons (`declaredPaths` as defining vocabulary, `runInlineExec` in the same prompt.md section) are left unruled; carry them as one narrower question or accept as debt.

Why it matters: both sections are stale against the tree, and the derive window now carries a spec commit that cites this ruling.
