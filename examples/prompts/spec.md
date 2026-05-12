# CURRENT STATE

<un-absorbed-workshop>
!`for f in workshop/*.md; do [ -e "$f" ] || continue; name=$(basename "$f"); if ! grep -rq "Discovery: workshop/$name" specs/ 2>/dev/null; then echo "$f"; fi; done`
</un-absorbed-workshop>

<active-specs>
!`find specs/active -name '*.md' 2>/dev/null | sort | head -60 || echo "(empty)"`
</active-specs>

<spec-flags>
!`cat specs/09-spec-flags.md 2>/dev/null | head -80 || echo "(no flags file)"`
</spec-flags>

# TASK

Pick exactly one action:

1. **Compile (workshop → active).** When un-absorbed workshop sources exist and their `Implied scope` is clear. Unit of work: one workshop source's full implied scope, derived across all named spec homes in one coherent commit. Honor `Supersedes:` — state the current choice as if it always was; never carry change-narrative. When `Implied scope` targets a spec in `_aligned/`, pull it back first (`git mv specs/_aligned/<path> specs/active/<path>`). Add `Discovery: workshop/<name>.md` references per touched section. Archive the source to `workshop/_archive/<name>.md` if fully absorbed.

   On uncertainty (malformed scope, implicit contradictions with no `Supersedes:`, open product calls), file under `specs/09-spec-flags.md → Compile deferrals` instead.

2. **Drift sweep.** When the corpus changed since the last sweep, cross-spec entity-name consistency check. File mismatches under `specs/09-spec-flags.md → Drift flags`. Never reconcile autonomously.

3. **Audit (idle).** When neither (1) nor (2) is pickable, walk the corpus and evaluate health signals (mechanical / structural / library-quality). Repair mechanical signals in-place; file the rest under `specs/09-spec-flags.md → Structural flags`. Weight `_aligned/` violations more heavily than `active/`.

4. **Hibernate.** When all three are no-op, exit without committing.

# OUTPUT

If you did any work, commit it prefixed `spec:`. The harness reverts your commit if you modify anything outside this phase's writable paths.

You may NOT:
- Modify `.flume/plan/**` (plan-loop territory).
- Touch code.
- Author new product decisions (workshop authority).
- Resolve implicit contradictions (defer to human).
- Graduate `active/` → `_aligned/` (plan-loop owns lifecycle).
