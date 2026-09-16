# A question re-filed as a record loses the ruling written into it (consumer adoption answers)

A 0.16.1 consumer holds three open questions it would re-file when it adopts.
Two carry an inline `RULED (operator, ref <sha>)` subsection recording the
disposition against the sha it was ruled at; the whole file is 201 lines for
three questions. A record is what was observed, where, and why it matters,
under 1,200 bytes, and plan owns `open-questions.md` alone. Neither shape has
a place for a ruling that arrived after the question.

Why it matters: the ruling is the durable half. A question re-filed without
it is re-opened, and the next plan tick re-derives an answer the operator
already gave.

The fork: an answered question leaves by being answered, and the ruling lands
in the commit body plus whatever it changed, so nothing is lost; or the
questions file states a ruling with its sha as part of its own shape, and the
drain preserves it.
