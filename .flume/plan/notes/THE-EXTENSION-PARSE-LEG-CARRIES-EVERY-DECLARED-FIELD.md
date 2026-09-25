# The full-field fixture is a second key set, checked but hand-valued

`everyPackageField` (`tests/harnessEntryExtension.test.ts`) values all seven
declared fields, and its key set is asserted equal to `entryExtension()`'s
before the parse — so an eighth package field reds here rather than slipping
past a narrower populated set. What no assertion can supply is a *value* a new
field's schema accepts: adding one reds this case, and the tester writes the
value by hand. That is the residual seam this entry could not close; a real
producer of extension values would close it, and the package has none.

The shared `entryQueue` base stays minimal on purpose. The
`contractTouching`-omission case (same file) reads `entryQueue({})` and asserts
the parsed entry has no such property, so folding the full set into the base
fixture would have made that case vacuous. Coverage lives in its own case
instead.

`PACKAGE_FIELDS` in that file is still `[...SPEC_FIELDS,
CONTRACT_TOUCHING_FIELD]` — a tester-side restatement of the declaration's key
set, used by three cases. The new case reads `Object.keys(extension)` directly;
the older ones could follow, but that is shape, not correctness, so it is
noted rather than filed.
