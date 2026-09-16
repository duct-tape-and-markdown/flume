# Ruled: 0.15.0's Breaking list names the type change; an unread git version warns

Closes the two questions parked at 3d77ab5a, each on its recommendation.

- *Does 0.15.0's shipped `### Breaking` list get amended?* — (a). The
  `TickResult.quarantinedTags` type change moves under 0.15.0's
  `### Breaking` in `CHANGELOG.md`, saying it was filed under Added at the
  cut and why it moved: the list documents the API, not the curation. The
  migration note's § 5.6 sentence that said the release did not list it
  shrinks in the same commit. Tag and tarball untouched. (c), a
  tag-to-tag surface diff read against the later Breaking list, is worth
  its own ruling and is not taken here.
- *What does the git floor say about a version it could not read?* — (a),
  as shipped: `spec/chain.md`'s floor bullet now names the third arm — an
  unread version warns, the floor unconfirmed rather than met, and silence
  is reserved for a floor that was read and cleared. Nothing derives; the
  sentence was the only thing missing.
