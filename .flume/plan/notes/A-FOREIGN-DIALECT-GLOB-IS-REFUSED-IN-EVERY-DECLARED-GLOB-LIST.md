# The dialect refusal is now the matcher's sentence, not each site's

Shipped as planned, with one shape change the entry did not name: the whole
refusal sentence moved to `foreignGlobRefusal` (`src/paths.ts`) beside
`foreignGlobForm`. Two loads refuse now, and the tail — "a literal character
in flume's dialect, path matching is matchesAny, spell the paths out" — is a
fact about the matcher, not about the field. Composed at each site it would
have been the matcher's rule spelled twice in two trees, one edit from two
answers. Each site prefixes only the field it read.

`supervisor.partitionIgnore` is deliberately *not* refused by the harness
declaration's `globs` shape: it is the engine's policy forwarded whole, and
the chain load refuses it at the field the engine names. One refusal at the
load that reads the value. The declaration case excuses it by name with that
reason beside the other four non-glob string lists.

Debt observed, not filed: `PartitionOptions.ignore` (`src/partition.ts`) is
public surface a caller can hand foreign globs to directly, with no load
between. Nothing refuses there, and nothing can without the engine policing
payload at a pure function's boundary — the chain surface is where the
declaration arrives, so this is likely correct as-is rather than a gap. Worth
a sentence in the spec if a consumer ever calls it by hand.

The declaration test walks `fullDeclaration()` for string lists and
partitions them into glob-shaped and excused-by-name, so a glob list the
schema gains lands in the complement and reds rather than shipping
unexercised. Five excused today: `agents.*.extraArgs`, `setup.directories`,
`slices.enabled`, `capabilities`, `supervisor.partitionIgnore`.
