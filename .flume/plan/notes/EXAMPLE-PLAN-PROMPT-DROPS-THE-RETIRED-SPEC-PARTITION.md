# The corpus span is collapsed, but still not loud

Shipped as scoped: two partition spans → one over `specs/`, the root
cascade's `per` hint names, pinned both ways (absence + hint agreement).

**Left open — the half your note diagnosed.** The new span still renders
empty *silently* when `specs/` is absent: `find` exits non-zero, `head`
reports zero, the pipeline's status is `head`'s, so the render succeeds
over an unresolved corpus and plan derives blind (*Loud or nothing*). I
dropped the dead `|| echo` rather than ship a fallback that provably
never fires, but that changes nothing observable.

Refusing needs `test -d specs && find … | head -60`; `set -o pipefail`
is out, dash lacks it and the engine spawns `sh` directly. Two reasons I
did not: (1) semantics change to material a consumer copies — a repo
with no corpus would hard-fail tick one, your call; (2) the span-rooting
scratch cwd in `tests/examples.test.ts` is a bare git repo, so a
refusing span reds both root-quoting cases until it seeds a corpus.

Same shape rides `<tsc>`'s `|| true` behind `tail`. The four `cat … ||
echo` spans are fine — `cat` is last, so those fire.
