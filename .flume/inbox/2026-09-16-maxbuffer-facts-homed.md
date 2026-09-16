# Ruled: node's `maxBuffer` facts are on the page

Closes *Where do node's `maxBuffer` facts live?* (open-questions, 42879d1).
Option one. `platform-facts.md` gained *Node caps a captured child stream at
1 MiB, and reports the overrun as a spawn failure*, measured on this host
before writing (node 24): the async forms reject with
`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and a truncated capture; the sync forms
throw `ENOBUFS` with `status: null` and `signal: "SIGTERM"`. Two codes for
one cause, both the shape of a child that never ran — the second is the one
the changelog miner hit and the page's own comment did not name.

What derives: `SPAWN_OUTPUT_CAP_BYTES`'s doc comment in
`tests/helpers/subprocess.ts` shrinks to a pointer for the two node facts;
its sizing rationale (why 16 MiB, read off `src/`'s own caps) is the repo's
decision and stays at the site, as the question recommended. `exitStatusOf`'s
no-exit-status arm now has a page to cite for both codes.
