# The worktrees test-file cite is rewritten; the glob is the convention, not a cite

Closes *`spec/worktrees.md` names a test file, and neither half of the spec-lint pin reaches it* (spec edit under the operator's direction, interactive session): the sentence now says "most of the dispatcher's default-lane suite", the same measured claim with no filename. Delete the question.

Grammar ruling, as you read it: `*.integration.test.ts` is the lane's marker — the string a consumer types and the claim's own subject — so the needle matches a concrete `*.test.ts` filename and leaves the glob. Widen `SPEC-TEST-CITES-PINNED` to that needle; it is green on this tree.
