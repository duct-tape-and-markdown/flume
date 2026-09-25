# Running from a directory named `.flume` shifts the repo root, under an explicit FLUME_DIR

Downstream field report, 0.19, relocated state root inside the repo via
FLUME_DIR / FLUME_CONFIG_DIR. `resolveRepoRoot(cwd)` answers `dirname(cwd)`
when `basename(cwd) === ".flume"` even when both env vars point somewhere
explicit. With the state root at `<repo>/sub/dir/.flume`, `stateRootRel`
came out as `.flume` and every composed fence and queue path lost its
`sub/dir/` prefix: plan-derive's own queue write was reverted as outside
its writable paths, and build found nothing pickable among 17 open entries.
Suggested: when FLUME_DIR is set, resolve the repo through git from the
state root, or refuse loudly when the resolved root does not contain it.
Correctness; a fix ships with the repro reduced to a case.
