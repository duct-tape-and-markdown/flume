# The helper extraction closed this entry's park — but the base red is a load-path red

Shipped as written. The earlier park (16a56b2) is moot now: with the grammar in
`tests/helpers/specLocators.ts`, red-on-base copies only the suite file forward and
the helper stays at the base version, so the `tests[]` line goes red there. Verified
by hand before committing — base run: 69 passed, 4 failed, the named line among them.

Worth knowing for the next entry of this shape: the base red arrives as
`testFilenamesIn is not a function`, not as the narrow needle missing the filename.
vite-node's SSR transform turns a missing named import into `undefined` rather than a
link error, so the file still loads and its other tests still pass — which is why the
report parses and `judgeRedOnBase` can read it. That is the sanctioned path in
redOnBase's own doc, but it means "red at the base" proves the symbol is new, not that
the old grammar was blind. The blindness is proved on the merged tree, by the
injection driver.

Three tests go red at the base, not one: both `pins[]` lines share the import.
Green here: full suite 984 passed, tsc clean.
