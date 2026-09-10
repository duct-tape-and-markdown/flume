// Plan-slice windows, rendered as data (`.flume/prompts/plan-*.md`).
//
// Each slice's material is a window off a cursor in state.md. Rendering it
// whole — or a contiguous oldest-first prefix within a line budget, naming
// the sha the cursor may advance to — is what turns "read the delta" from an
// errand into input. A truncated preview is the shape this replaces: too big
// to be a pointer, too small to be the material.
//
// Runs as an inline-exec span in the tick's worktree, so `git` sees the
// tick's own tree and `.flume/plan/state.md` is the tracked copy at the tip.
// Runtime records (prior attempts, verdicts — build's refusals, which the
// inbox slice reconciles) live only under the primary
// state root, which the dispatcher hands every child as FLUME_DIR.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [mode, budgetArg] = process.argv.slice(2);
const BUDGET = Number(budgetArg ?? 1200);
const STATE = ".flume/plan/state.md";
const SWEEP_DOMAIN = [
  "src", "tests", "bin", "examples",
  ".claude/rules/engineering.md", ".claude/rules/engine-boundary.md",
];

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });
const out = (s = "") => process.stdout.write(s + "\n");

function stampOf(label) {
  if (!existsSync(STATE)) return undefined;
  const m = new RegExp(`^${label}\\s*\`?([0-9a-f]{7,40})`, "m").exec(readFileSync(STATE, "utf8"));
  return m?.[1];
}
function resolves(sha) {
  try { git("rev-parse", "--verify", "-q", `${sha}^{commit}`); return true; } catch { return false; }
}
function commits(range, pathspec = []) {
  const raw = git("log", "--reverse", "--format=%H%x00%s", range, "--", ...pathspec).trim();
  return raw ? raw.split("\n").map((l) => { const [sha, subject] = l.split("\0"); return { sha, subject }; }) : [];
}
const lines = (s) => (s.match(/\n/g) ?? []).length + 1;

/** Oldest-first diffs within BUDGET; a commit over budget on its own still renders. */
function renderPrefix(list, showArgs) {
  let used = 0, rendered = 0, advance, stopped = false;
  const deferred = [];
  for (const c of list) {
    if (stopped) { deferred.push(c); continue; }
    const diff = git("show", "--stat", "-p", c.sha, ...showArgs);
    if (rendered > 0 && used + lines(diff) > BUDGET) { stopped = true; deferred.push(c); continue; }
    out(diff.trimEnd()); out();
    used += lines(diff); rendered++; advance = c.sha;
  }
  return { advance, rendered, deferred };
}

function refuse(label, sha) {
  out(`REFUSE: ${label} ${sha} does not resolve to a commit. Process nothing and advance nothing this tick; repair the stamp in ${STATE} and say so in the commit body.`);
}

switch (mode) {
  case "derive": {
    const stamp = stampOf("Spec derived through:");
    if (!stamp) {
      out("(bootstrap: no derive stamp — the whole corpus is the delta; read every file below in full and stamp HEAD)");
      out(git("ls-files", "spec").trim());
      break;
    }
    if (!resolves(stamp)) { refuse("derive stamp", stamp); break; }
    const all = commits(`${stamp}..HEAD`);
    const spec = commits(`${stamp}..HEAD`, ["spec/"]);
    out(`=== ${spec.length} spec commit(s) since ${stamp}, among ${all.length} commit(s) landed alongside ===`);
    for (const c of all) out(`${spec.some((s) => s.sha === c.sha) ? "spec " : "     "}${c.sha} ${c.subject}`);
    out();
    if (spec.length === 0) { out("(no spec changes since the stamp)"); break; }
    const { advance, rendered, deferred } = renderPrefix(spec, ["--", "spec/"]);
    out(`=== rendered ${rendered} spec commit(s) in full; the stamp may advance to ${advance} ===`);
    if (deferred.length) { out(`=== ${deferred.length} spec commit(s) beyond this tick's budget re-appear next tick: ===`); for (const c of deferred) out(`${c.sha} ${c.subject}`); }
    break;
  }
  case "sweep": {
    const stamp = stampOf("Posture swept through:");
    if (!stamp) { out("(bootstrap: no sweep stamp — stamp HEAD and say so in the commit body)"); break; }
    if (!resolves(stamp)) { refuse("sweep stamp", stamp); break; }
    out(`=== commits since ${stamp} touching the sweep domain or a posture page ===`);
    out(git("log", "--reverse", "--format=%h %s", "--name-only", `${stamp}..HEAD`, "--", ...SWEEP_DOMAIN).trim() || "(none)");
    out();
    out("=== spec lines deleted since the stamp (retired-claim delta) ===");
    const del = git("diff", `${stamp}..HEAD`, "--", "spec/").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    out(del.length ? del.join("\n") : "(none)");
    break;
  }
  case "build-records": {
    const flumeDir = process.env.FLUME_DIR ?? ".flume";
    const dir = join(flumeDir, "prior-attempts");
    const recs = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
    out(`=== ${recs.length} standing prior-attempt record(s) ===`);
    for (const n of recs) { out(`--- ${n} ---`); out(readFileSync(join(dir, n), "utf8").trimEnd()); }
    const log = join(flumeDir, "tick-verdicts.jsonl");
    const last = existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((v) => v?.phaseName === "build").at(-1)
      : undefined;
    out(`=== last build verdict ===`);
    if (!last) { out("(none)"); break; }
    out(`${last.at}  ${last.summary}`);
    for (const m of last.mergeOutcomes ?? []) out(`${m.tag}: ${m.outcome}${m.outcome === "not-shipped" ? "  ← parked: the entry stays; reconcile it" : ""}`);
    break;
  }
  default:
    console.error(`delta-window: unknown mode '${mode}' (derive | sweep | build-records)`);
    process.exit(2);
}
