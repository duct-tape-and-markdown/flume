# The script runner reads verdict lines; a real validator emits one document (consumer adoption answers)

spec/harness.md *The runner interface* rules the script runner as a command
run once per operation, the named lines as its arguments, "reading one verdict
line per name from its stdout". The first consumer the runner was priced for
has no per-check line mode: its validator takes three flags, none of them a
reporter selector, and emits a single JSON document whose drift key is absent
entirely on a clean run.

Why it matters: the ruling's shape excludes the validator it was written for.
Adapting it costs the consumer a wrapper the package was meant to remove, and
a wrapper every non-JS consumer writes is the missing surface the runner row
exists to close.

The fork, one line each:
- the runner reads lines, and the package ships the wrapper idiom in docs;
- the runner declares its reader, lines or a document shape, in the factory.

Also observed: the drifted tuple names a graph id, not the file carrying it,
so a named line cannot report its carrying file. That one is the consumer's
tool to fix, not the package's.
