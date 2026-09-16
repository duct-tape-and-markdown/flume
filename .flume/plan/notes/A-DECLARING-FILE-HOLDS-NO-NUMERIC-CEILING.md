# The ceiling verdict moved rather than doubled

Judgment call worth a look. Rather than adding a third verdict beside
`sites.ceilings`, the ceiling verdict *moved* off the spawning set onto
`SpawnScan.registrars` — every registrar a declaring file holds. Two
overlapping ceiling verdicts would have been the restatement the `per`
section is about, and the spawning set is a subset of the new one for any
declaring file.

What that trades away: a spawning registrar with a numeric ceiling in a file
that declares *no* file-scope budget is no longer reported as a ceiling. It is
still a `files` finding — "declares no file-scope `vi.setConfig` budget" — and
the moment it declares, its ceilings red. Judged the louder, earlier verdict;
flagging here in case plan wants the pair kept.

Scale: the widening takes the judged set from 761 spawning sites to 1207
registrars across the default lane, 446 of them non-spawning. All green today,
so the entry shipped as a pin. The integration lane declares no budget and is
untouched, so its `30_000`s in `examples.integration.test.ts` stay outside the
rule.
