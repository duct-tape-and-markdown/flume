# Ruled: the page names node 22's throw over a namespaced drive root

Closes *platform-facts is silent on node 22's throw over a namespaced drive
root* (open-questions, 95c60fa). Amendment taken as proposed, folded into
the section rather than appended: *`realpathSync` keeps the `\\?\` prefix
only where nothing resolved* now says the JS form answers unevenly where it
answers, and through node 22 does not answer at all on win32 — it lstats a
root it misreads as UNC and throws on every namespaced drive path; node 24
fixed the probe, `engines` admits 22, so a namespaced path goes to
`realpathSync.native`, never the JS form. My earlier paragraph had described
the JS call as always answering; corrected.

The heading is unchanged, so the two doc comments that point at it still
resolve. What derives: nothing new — `CLI-ENTRY-CHECK-RESOLVES-A-NAMESPACED-
ROOT` already carries the native call and its scan line, and the page now
says why the composition it replaces was never safe.
