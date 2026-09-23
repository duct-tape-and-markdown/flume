/**
 * The script runner the package ships (`spec/harness.md`, *The runner
 * interface*) — for a consumer whose proof is a validator rather than a test
 * tool.
 *
 * One declared command carries all three operations. It runs once per
 * operation, in the tree under judgment, with the named lines as its
 * arguments, and writes its report to stdout. Exit status is not the verdict;
 * the report is. A validator that exits non-zero because something it checked
 * is wrong has still answered every name it was asked about, and a judge
 * reading the status instead would rule on a fact nobody stated
 * (`.claude/rules/engine-boundary.md`, *Told, not inferred*). So the status
 * `captureRun` reports beside the output is deliberately unread here — a
 * validator says nothing by it that its report does not say better — and
 * what bounds that is the reconciliation below, which refuses an answer set
 * that is not one answer per name however the command exited.
 *
 * What that report *says* is the consumer's, so {@link ScriptRunnerOptions}
 * carries a reader over the command's whole stdout. A validator that already
 * emits one document — a JSON summary whose clean run omits its drift key —
 * declares a function over that document and ships no wrapper script; the
 * reader is the package's, never a second program beside the first.
 *
 * Absent one, {@link readVerdictLines} is the default, and the encoding it
 * reads is declared here because the spec fixes the line's *fields* — the
 * name, whether a passing check carried it, and the file that did — and
 * leaves their spelling to whatever ships them. It is tab-separated, one line
 * per name, each line led by a marker so a validator's own output can share
 * the stream:
 *
 * ```
 * flume<TAB>pass<TAB><file><TAB><name>
 * flume<TAB>fail<TAB><TAB><name>
 * ```
 *
 * - `<file>` is the run-relative, forward-slashed path of the file whose
 *   passing check carried the name — the file a base run lays over the base
 *   tree. A `pass` line names one; a `fail` line names none, because no file
 *   carried it.
 * - `<name>` is the requested line verbatim, and runs to the end of the line,
 *   so a name carrying a tab of its own still reads back whole.
 * - Every other line on stdout is the validator's own output and is passed
 *   over. A line led by the marker is a verdict line and is held to the shape
 *   above; a malformed one is refused rather than skipped, since skipping it
 *   would report the name as uncarried and pin a runner's defect on build.
 *
 * Whichever reader ran, the answers it returns are reconciled against the
 * names that were asked about: a set that does not answer exactly those —
 * one missing, one twice, one nobody asked for — is refused at the point of
 * detection (`.claude/rules/engineering.md`, *Loud or nothing*). That is the
 * runner interface's own guarantee rather than an encoding's, so a declared
 * reader inherits it instead of restating it.
 */

import { isAbsolute, resolve, sep } from "node:path";

import { escapesRoot, gitPath } from "../src/paths.js";

import { resolveLanes } from "./runner.js";
import type {
  Lane,
  NamedResult,
  RunResult,
  Runner,
  RunnerContext,
  RunnerFactory,
} from "./runner.js";
import { baseTree, captureRun } from "./toolRun.js";

/** The first field of a verdict line, and nothing else on stdout. */
const MARKER = "flume";

/** What a verdict line's second field may say. */
const PASS = "pass";
const FAIL = "fail";

/** What one run of the declared command produced, and what was asked of it. */
export interface ScriptReport {
  /** Everything the command wrote to stdout, verbatim. */
  readonly stdout: string;
  /**
   * The names it was handed, in the order they were requested. A reader over
   * a document answers these — the document states what the validator found,
   * and which of it answers which name is the reader's to say.
   */
  readonly names: readonly string[];
  /**
   * The tree the run happened in — the caller's for `run`, the base checkout
   * for `runAtBase`. A reader's own refusal names it, so a message says which
   * run produced the report it choked on.
   */
  readonly cwd: string;
}

/**
 * How a consumer's validator says what it found: one answer per name it was
 * asked about, in any order, refused by the runner if the set is not exactly
 * that.
 *
 * A file named on a carried answer is run-relative and forward-slashed — the
 * file a base run lays over the base tree.
 */
export type ScriptReader = (report: ScriptReport) => readonly NamedResult[];

/**
 * Decode one marked line, or throw naming what it said. `where` is the tree
 * the line came from, so a refusal says which run produced it.
 */
function readLine(line: string, where: string): NamedResult {
  const [, verdict, file, ...rest] = line.split("\t");
  const quoted = JSON.stringify(line);
  if (rest.length === 0) {
    throw new Error(
      `scriptRunner: the command in ${where} wrote a verdict line with fewer than four ` +
        `tab-separated fields: ${quoted}. The shape is ` +
        `\`${MARKER}<TAB>${PASS}|${FAIL}<TAB><file><TAB><name>\`.`,
    );
  }
  const name = rest.join("\t");
  if (verdict !== PASS && verdict !== FAIL) {
    throw new Error(
      `scriptRunner: the command in ${where} wrote ${JSON.stringify(verdict)} where a ` +
        `verdict line says \`${PASS}\` or \`${FAIL}\`: ${quoted}.`,
    );
  }
  if (verdict === FAIL) {
    if (file !== "") {
      throw new Error(
        `scriptRunner: the command in ${where} named a file on a \`${FAIL}\` line: ` +
          `${quoted}. The file a verdict line carries is the one whose passing check ` +
          `carried the name, and nothing carried this one.`,
      );
    }
    return { name, carried: false, files: [] };
  }
  // Folded into git's alphabet before it is judged, so a win32 validator's
  // separators read the way a posix one's do. Where it lands is then asked of
  // `escapesRoot`, the engine's one spelling of "leaves a root" — a prefix
  // test here would read `checks/../../outside` as inside, and the judge would
  // lay it over the base tree's parent (`.claude/rules/engineering.md`, *The
  // fix lands at the mechanism*).
  const raw = file ?? "";
  const relative = gitPath(raw);
  const root = resolve(where);
  if (relative === "" || isAbsolute(raw) || escapesRoot(root, resolve(root, relative))) {
    throw new Error(
      `scriptRunner: the command in ${where} wrote a \`${PASS}\` line naming ` +
        `${JSON.stringify(raw)} where a run-relative file goes: ${quoted}. The judge ` +
        `lays that file over the base tree, which an absent or outside path cannot reach.`,
    );
  }
  return { name, carried: true, files: [relative] };
}

/**
 * The default reader: one verdict line per name, in the encoding this
 * module's header states, with every unmarked line passed over as the
 * validator's own output.
 *
 * It reads only the lines, never the names it was handed: which names were
 * asked about is the reconciliation's question, and answering it twice is how
 * two refusals drift apart.
 */
const readVerdictLines: ScriptReader = ({ stdout, cwd }) =>
  stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(MARKER + "\t"))
    .map((line) => readLine(line, cwd));

/**
 * One answer per requested name, in the order they were requested.
 *
 * The three ways an answer set can fail to be one — a name unanswered, a name
 * answered twice, an answer nobody asked for — are each refused here, for
 * whichever reader produced it. Reading a missing answer as "no check carried
 * it" would turn a validator's defect into a refusal build cannot act on, and
 * an unrequested name means the report and the request disagree about what
 * was asked.
 */
function answersFor(
  read: readonly NamedResult[],
  names: readonly string[],
  where: string,
): NamedResult[] {
  const lead = `scriptRunner: reading the command's report from ${where}`;
  const seen = new Map<string, NamedResult>();
  for (const answer of read) {
    if (seen.has(answer.name)) {
      throw new Error(
        `${lead} answered ${JSON.stringify(answer.name)} twice. One answer per name; ` +
          `which one holds cannot be guessed.`,
      );
    }
    seen.set(answer.name, answer);
  }

  const asked = new Set(names);
  const extra = [...seen.keys()].filter((name) => !asked.has(name));
  if (extra.length > 0) {
    throw new Error(
      `${lead} answered ${extra.length} name(s) nobody asked about: ` +
        `${extra.map((n) => JSON.stringify(n)).join(", ")}. ` +
        `The names it was handed are its arguments.`,
    );
  }
  const missing = names.filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${lead} answered nothing for ${missing.length} of ${names.length} name(s): ` +
        `${missing.map((n) => JSON.stringify(n)).join(", ")}. ` +
        `A name with no answer is not a name nothing carried.`,
    );
  }
  return names.map((name) => seen.get(name)!);
}

/** What a consumer declares to {@link scriptRunner}. */
export interface ScriptRunnerOptions {
  /**
   * The command to spawn, once per operation, in the tree under judgment.
   *
   * Resolved the way a shell resolves one: a command carrying a path
   * separator is the tree's own and is resolved against the tree the
   * operation runs in — so a base run drives the base tree's copy of the
   * validator, not the caller's — while a bare name is found on `PATH`. A
   * relative command left to the platform resolves against the parent's
   * working directory on some hosts and the child's on others, which is a
   * base run judging the wrong tree with nothing to show for it.
   */
  command: string;
  /**
   * The arguments the command takes ahead of the named lines. The same in
   * every operation: the tree under judgment differs between them, never the
   * question asked.
   */
  args?: readonly string[];
  /**
   * How the command's stdout answers the names it was handed. Defaults to
   * {@link readVerdictLines}, the line encoding this module's header states.
   *
   * A validator that already reports one document declares a function over
   * that document here — the whole of stdout, parsed however it is written —
   * rather than a script that reprints it as lines. What the reader hands
   * back is reconciled against the requested names either way.
   */
  read?: ScriptReader;
  /**
   * The consumer's lanes. Defaults to the single unsplit lane; a consumer
   * whose validator splits — a fast check and a slow one — declares both
   * here, and the running lane's exclusions are rendered into plan's
   * `tests[]` and `pins[]` hints (`spec/harness.md`, *The runner interface*).
   */
  lanes?: readonly Lane[];
}

/**
 * What one complete answer set reports.
 *
 * `passed` counts the names a passing check carried — the judge's vacuity
 * check, and the only count these answers carry. `failed` is zero and
 * `failures` empty for the same reason: a name nothing carried is reported as
 * `carried: false`, which is the judge's `unnamed`, while a check that failed
 * over something no name asked about is not a fact a reader is asked to
 * state. And `ok` is true wherever this is reached at all — an incomplete or
 * malformed set threw before it, and the exit status was never the verdict.
 */
const reportOf = (names: readonly NamedResult[]): RunResult => ({
  ok: true,
  passed: names.filter((n) => n.carried).length,
  failed: 0,
  names,
  failures: [],
});

/**
 * Declare the script runner: a consumer whose proof is a validator declares
 * the command that reports what it found, and the reader that turns that
 * report into an answer per name.
 *
 * Returns the factory, not the runner, for the reason every runner is
 * declared as one (`runner.ts`, {@link RunnerFactory}): a base run needs the
 * tree at a sha and the consumer's own provisioning, and only the chain load
 * holds either.
 */
export function scriptRunner(options: ScriptRunnerOptions): RunnerFactory {
  const lanes = resolveLanes("scriptRunner", options.lanes);
  const args = options.args ?? [];
  const read = options.read ?? readVerdictLines;
  /** Whether the command names a file rather than something on `PATH`. */
  const pathed = options.command.includes("/") || options.command.includes(sep);
  /** The command as the tree under judgment spells it. */
  const commandIn = (tree: string): string =>
    pathed && !isAbsolute(options.command) ? resolve(tree, options.command) : options.command;

  const runIn = async (tree: string, names: readonly string[]): Promise<RunResult> => {
    const { stdout } = await captureRun(commandIn(tree), [...args, ...names], tree);
    return reportOf(answersFor(read({ stdout, names, cwd: tree }), names, tree));
  };

  return ({ api, provision }: RunnerContext): Runner => ({
    lanes,

    run: (names, cwd) => runIn(cwd, names),

    async runAtBase(names, files, baseSha, cwd) {
      const worktree = await baseTree(
        { api, provision },
        { label: "scriptRunner.runAtBase", files, baseSha, cwd },
      );
      return runIn(worktree, names);
    },
  });
}
