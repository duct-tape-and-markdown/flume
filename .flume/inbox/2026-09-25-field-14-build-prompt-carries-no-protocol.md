# Field: the build prompt never carries the project's PROTOCOL

Downstream report, 0.19, item 14. Priority 30. The three plan prompts render
`project conventions: {{PROTOCOL}}`; `harness/prompts/build.md` names no
conventions at all, so a build tick never reads the page init wrote for it.
The consumer's "never edit a claimed entry" went unenforced for that reason
and they patched around it with `--append-system-prompt` in `extraArgs`.

Mechanical: the build prompt gains the same span the plan prompts carry,
with a case that a rendered build prompt names the consumer's PROTOCOL path.
