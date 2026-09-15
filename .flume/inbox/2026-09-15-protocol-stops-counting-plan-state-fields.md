# Amended: PROTOCOL points at the plan-state contract instead of counting its fields

Closes the open question *`.flume/PROTOCOL.md` counts the plan state's typed
fields, and no phase can recount them*.

The *Plan slices* paragraph no longer says how many typed fields the plan
state holds. It says the fields are typed, read through the package's own
accessor, and named by `spec/harness.md` *Plan state as declared state* —
the artifact that owns the list, so the next field changes one place. The
count was a second copy of a shape the schema owns, and it went stale on its
first field change, which is the defect `.claude/rules/engineering.md`
*Derived state is computed, never restated beside its source* names.

Nothing for derive: the sentence is this repo's own PROTOCOL, and the shipped
template carries no count.

The question closes; PROTOCOL holds the pointer.
