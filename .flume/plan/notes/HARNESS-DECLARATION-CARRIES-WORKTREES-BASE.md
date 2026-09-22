# The spec's declaration table now trails the schema by one row

`DeclarationSchema` gained `worktreesBase`, and both docs lists follow
because the field-set pin reds otherwise. Two things in `spec/harness.md`,
*What a consumer declares*, are the human's:

- the table carries no `worktreesBase` row;
- its opening says "three of its fields are values with behavior (the
  runner, the resolver, and a handoff override)". Top-level it is now four,
  and `ci.titles` makes five nested. `docs/CHAIN-AUTHORING.md` carried the
  same count and now enumerates rather than counts, since the next such
  field restales a number. The spec sentence still counts.

This entry's first attempt was gate-reverted on a red trunk it never
touched (both inbox records of 775e98bb). The diff is unchanged in
substance; nothing in it was the failure.
