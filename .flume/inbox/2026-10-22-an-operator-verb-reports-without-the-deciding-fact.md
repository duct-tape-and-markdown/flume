# An operator verb reports its outcome without the fact that decides it (downstream consumer report, class)

**Kind.** A verb succeeds or refuses while a fact the engine holds — and that
determines what happens next — goes unsaid, so the operator rebuilds it by
experiment. `engineering.md`, *A fact the engine holds is reported, never
rediscovered*.

**Members.**
- `flume wake build` exits 0 and says "woke" while `<flumeDir>/stop` stands
  and the next `loop` will refuse. The verb already names the other marker
  deciding the phase ("hold cleared", `BATON_MUTATIONS`, `src/cliBaton.ts`);
  the stop flag is a third marker it leaves unnamed. The no-`resume` ruling
  stands (`spec/cli.md`, *Subcommand surface*) — the defect is the silence,
  not the absent verb.
- `flume tick plan-derive` exits 2 with the usage line alone; the refusal
  does not name the word it refused. The usage line does name `--phase`, so
  the consumer's "name the flag" half already holds; whether the positional
  form is accepted is a CLI design question, not filed.
- A running loop holds the run-scoped policy it bound at start
  (`quarantineScope`, `abortThreshold`, `maxTicks`, `spec/chain.md`), and the
  spec itself says a change is ignored "with no indication". The consumer's
  "the declaration loads once per loop" contradicts the per-tick reload
  `spec/chain.md` states — **needs a repro naming the field changed** before
  it is anything more than this member.
- Seven hours of two slots inside one gate produced no line: a running
  gate's elapsed time is a fact nothing reports (the unbounded half is
  `2026-10-22-a-spawned-child-cannot-fail-on-its-own.md`).

**Owning artifact.** Per verb, the output that already exists — `wake`'s
clause, the usage refusal's shared path in `src/cliArgs.ts`, `status` — each
gains the fact; no new verb.
