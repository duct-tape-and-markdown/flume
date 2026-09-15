# Hiding the host's forge takes git with it on the POSIX runner

`plantForge` now drops every PATH directory holding a `gh` of its own, not
just prepends its own. On `ubuntu-latest` that is `/usr/bin`, which holds git
too — so the fixture links the host's git back into the stub's directory, and
from this commit forward every `tests/harnessCi.test.ts` case on the POSIX
lane reads its branch through that link. Locally the two dirs differ, so the
link fires only in the staged case; the first real exercise is the next POSIX
lane run. Worth a read of that run's result.

Two paths no lane exercises: `linkGit`'s win32 refusal (fires only on a host
that installs git and the forge CLI in one directory — `windows-latest` does
not), and, on win32, the reader's own shell retry reaching the stub's `.cmd`
after the direct spawn ENOENTs. Both are the win32 lane's to prove, not this
host's.
