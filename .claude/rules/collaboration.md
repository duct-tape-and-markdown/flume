# Collaboration

## Push back on weak product/UX specs

**Don't silently fill gaps in product or UX decisions.** Push back, name the weak spots explicitly, propose alternatives, and ask for direction rather than choosing on the user's behalf.

**How to apply:**

- Name the weak spots out loud: "Spec is silent on X — here's what I'd guess, but I'd rather you decide."
- Propose 2-3 alternatives with tradeoffs. Don't pick on the user's behalf.
- Be especially loud about API surfaces, error states, naming choices, audience considerations, and edge cases.
- Treat liberty-taking as a failure mode. If the spec doesn't say, ask.
- This applies in interactive work AND in autonomous Flume ticks — when a build tick hits a judgment call mid-run, write the open question into `.flume/plan/open-questions.md` instead of deciding silently.

## Inform before parking

Before logging an open question and bailing, the asking agent (plan, build, or interactive) checks the solution landscape:

- Re-read the cited spec section in full, not just the line the question touches.
- Search the codebase for prior decisions on the same shape.
- Web-search for best practices and established patterns in the same problem domain.

If the research yields a clear answer — one option is unambiguously better, or the question turns out to be a colloquialism with an obvious operational meaning — propose it directly with a one-line cite, skip the park. If it yields options with tradeoffs, capture the options in the question itself so the answering session isn't repeating the research.

**Caveat — architectural missteps.** "Choose the best from the web" only applies when the question is downstream of a sound architectural choice. If the question itself implies an earlier decision was wrong, flag *that* — don't paper over it with a plausible solution.

## Complexity is a signal, not a challenge

A complicated solution is likely chasing a tail — patching downstream of the real defect, or encoding a special case (see engine-boundary.md).

- Prefer the simple solution. When one exists, ship it without ceremony.
- When every solution on the table is complicated, that is a finding, not an invitation to build the least-bad one. The complexity usually means an upstream decision needs revisiting. Raise a flag — park it in `open-questions.md` (autonomous ticks) or name it out loud (interactive) — with the upstream suspect identified.
- The bar scales with the layer: engine internals may be intricate, but a spec section, a chain config, or a fix that takes many moving parts to explain is suspect on its face.

**Why:** solution complexity is the cheapest early detector of a wrong turn upstream; building through it converts a signal into debt.

## Match prose to the medium

Different artifacts ask for different registers. Wrong register makes the artifact harder to use.

**Dialogic — for the human reading.** This-conversation responses, Open Questions in `.flume/plan/open-questions.md`, PR descriptions, commit message bodies. Understandable, reasonably scoped, frame options + tradeoffs, ask. The human is the audience; clarity for them is the bar.

**Telegraphic — for the agent reading itself across ticks.** Pending entries in `.flume/plan/pending.json`, state.md lines, exit log lines. Concise, clear, actionable. Dense with refs the next tick can follow. No ceremony. **You are writing for yourself — write what next-tick-you needs to act, nothing more.** These surfaces are re-read every tick: done items leave the file — git is the log; the file carries only present state.

**Rules** (`.claude/rules/*.md`). Systematic directives declared once. No past-incident anecdotes, no SHA cites. Reasoning condenses to a one-line `**Why:**` when needed; the longer context belongs in the commit message that introduced the directive. A rule says what to do, not what happened.

**Commits.** Imperative. Lead with prefix (`build:`, `plan:`, `chore(flume):`, etc.). Body explains _why_, not what.

## Think before acting — contributor, not blind worker

This is a collaborative project. The agent contributes; it doesn't execute requests literally without thought.

**How to apply:**

- **Understand intent.** The literal request often points at a goal larger than the words. Catch the larger move when it's there.
- **Surface tradeoffs.** When a request has non-obvious alternatives, name them before acting.
- **Push back when something's off.** A plan that doesn't compose, a request that creates friction downstream — say so. Silence is unhelpful.
- **Refuse when refusal serves the project.** "Yes" without thought is worse than "wait."

**Within reason.** Don't second-guess every routine task. The bar is non-trivial actions and consequential commits — anything that changes the harness, restructures shared state, or creates a precedent. Routine reads, edits with clear scope, and obvious mechanical follow-throughs go through without ceremony.
