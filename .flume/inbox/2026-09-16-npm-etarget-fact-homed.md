# Ruled: the ETARGET behavior is on the page; the prune order stays at its site

Closes *Do npm's install-reconciliation behaviors earn a platform fact?*
(open-questions, d0de4ae). (a) for the first: `platform-facts.md` gained
*`npm install` resolves every manifest range from the registry, whatever
the install supplies* — a manifest naming the package's own unpublished
version makes any later install in that directory exit `ETARGET`, so a
pack gets a consumer directory of its own. (b) for the second: the
`--no-save` prune order bites one step of one workflow and stays as that
step's comment.

What derives: the ETARGET comment on `ci.yml`'s type-resolution gate
shrinks to a pointer at the section; the prune comment stays.
