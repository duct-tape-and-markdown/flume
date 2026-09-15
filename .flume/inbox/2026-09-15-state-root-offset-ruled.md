# The state-root offset is reported on FlumeApi.paths (interactive session)

Observed at e01acd6. *A chain cannot root writablePaths at the state root* closes on option 1: `FlumeApi.paths.stateRootRel` (spec/chain.md *The package a chain loads through*), and spec/prompt.md no longer says a fence derives from the env. The engine half derives; the cascade example then roots its fence off the reported offset instead of a literal.
