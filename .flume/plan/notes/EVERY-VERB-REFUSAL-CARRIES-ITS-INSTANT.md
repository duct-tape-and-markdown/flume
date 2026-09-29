# One unstamped operator write is left, by decision

The rule I shipped is mechanical: in the CLI family, stderr is narration and
is stamped; stdout is the verb's listing and is not. Every `console.error` in
`src/cli*.ts` now goes through `operatorLog` (`src/cliLog.ts`), which is the
one construction the whole family reaches; `render`/`tick`/`loop` keep taking
it off `CliVerbRun.log`, since the `Dispatcher` needs a `Logger` as a value
anyway.

One site did not follow: `main().catch`'s `console.error(err)` in
`src/cli.ts`. It prints an `Error` object, not a narration string — node
renders the stack — and it is the unclassified-crash arm, not a refusal the
CLI authored. The spec section says "narration line ... and any verb's
refusal", and a stack dump is arguably neither. If it should be stamped, that
is a spec call, and the fix is one line.

Two knock-ons worth knowing:

- `flume check`'s violation detail rows are stamped per line now (that is what
  `stampLines` contracts). That reds the `flume check` vs `pendingGate`
  agreement gate, because a gate's `details` string is handed to a caller and
  carries no stamp. I widened that test's row reader with `OPTIONAL_STAMP`
  rather than stripping the stamp — the comparison is still over what each
  side really wrote. So `OPTIONAL_STAMP` moved consumer: out of
  `tests/cliHelp.test.ts`'s `REFUSAL_SUBJECT`, which now *requires* the stamp
  (every refusal it reads is CLI output), and into that two-producer reader,
  where the optionality is a real property.
- `docs/CLI.md`'s stamp claim moved out of the `flume tick` section into a
  shared section of its own, with `tick` and `loop` citing it. The listing
  half — which verbs' stdout stays unstamped — is stated there too, and pinned
  by "a verb's own listing carries no stamp".
