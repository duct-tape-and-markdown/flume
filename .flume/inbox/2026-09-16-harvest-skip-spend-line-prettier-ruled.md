# Ruled: the harvest skips dot-names; the spend line stays; prettier stays out

Closes the three questions parked at 051d4e15.

- *Does the teardown harvest take the dot-name skip?* — (a). `spec/chain.md`
  *`Chain.friction`* now names the harvest as the fourth surface, with the
  reason: a relay under a stamped name would turn a skipped name into an
  unskippable one. What derives: `harvestFriction` takes `isDotName`.
- *What spelling does the completion summary's spend line take?* — (a),
  keep it as shipped. The operator's quota counts tokens, not dollars, so a
  line that names cache-write and cache-read beside cost is the one that
  answers "why is this run expensive". Nothing derives.
- *Is prettier the tree's formatter?* — (a). The operator ruled earlier in
  this effort that prettier stays out; `platform-facts.md` now carries the
  measured fact — no config, reflows at 80 against a tree at 100, format by
  hand — so the next tick does not pay it again. Nothing derives.
