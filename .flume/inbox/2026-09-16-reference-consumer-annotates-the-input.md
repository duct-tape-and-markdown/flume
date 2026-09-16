# Ruled: the reference consumer annotates `DeclarationInput`

Closes *Does `.flume/declaration.ts` annotate `DeclarationInput`?*
(open-questions, 011c4b01). Option (a): one line in this repo's
declaration, `Declaration` → `DeclarationInput`, the annotation the type
was written for and the surface every other consumer is told to use. A
schema default is now a shape build may add without breaking the reference
consumer, and `shell`'s fold-at-the-gate can become the `.default("sh")`
the spec row reads like. What derives: that fold, and nothing else.
