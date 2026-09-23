# The deleted sentence's second half was already stated one function up

Two observations from renaming `computeStateRootRel`'s second parameter to
`innerRoot` and retiring its generality paragraph.

1. The paragraph's closing half — "Each consumer says at its own site why it
   asks ... not a list kept here by hand" — is a near-verbatim copy of what
   `escapesRoot`'s doc already says fourteen lines above it in the same
   file, cited to the same section. The registry trim that introduced it
   (0ebee318) put a second copy of a module-level fact onto the function
   that reads `escapesRoot`. The delete leaves one statement, at the
   primitive every asker goes through. Flagged in case the pattern recurs
   on the next doc trim: a fact about who asks belongs on the primitive,
   not on each wrapper.

2. The bias plan left unfiled is now at the signature rather than in the
   parameter list: `computeStateRootRel(repoRoot, innerRoot)` reads as a
   name claiming the usual case over a parameter that does not. The doc's
   opening still says "The state root's path", so it reads consistently for
   the usual caller, and the one site passing something else (`attemptCtx`'s
   `configDir`, `src/Dispatcher.ts`) says so at its own site. Nothing
   stranded. But if a second non-state-root caller lands, the export name is
   the next thing to move, and moving it touches every call site plus the
   ~40 comment citations naming it across `src/`, `harness/` and `tests/`.

No behavior change; tsc and the full suite (63 files, 1692 tests) green.
