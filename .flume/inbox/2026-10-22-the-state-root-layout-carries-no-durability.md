# The state root's layout names every entry but not which ones are run memory (downstream consumer report, class)

**Kind.** `STATE_ROOT_NAMES` (`src/paths.ts`) is the one home for the state
root's layout, and the runtime ignore set derives from it. Whether an entry
is durable run memory (prior-attempt records, verdict log and files, baton
markers) or per-process (lock, `merging/`, worktrees, `invocations/`) is a
fact the engine holds and no artifact states, so any operation that crosses
hosts or wipes state rediscovers it.

**Members.**
- Field instance: moving a loop to another host took a hand rsync of
  `prior-attempts/`, `tick-verdicts.jsonl`, `tick-verdict/`, `awake/`;
  without it, retries lost their failure notes. Consumer asked for
  `export-state`/`import-state` or a carry list.

**Owning artifact.** `STATE_ROOT_NAMES` gains the classification beside each
name; a carry list (docs) and any future export derive from it rather than
restate it. Verbs only when a measured need beyond the derived list appears
(tenet: subtraction first).
