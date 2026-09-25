# Field: there is no memory guidance for the tick budget

Downstream report, 0.19, item 12. Priority 30, a docs entry. `maxTicks: 3`
with an eight-wide wave exhausted a 32 GB host and the kernel killed the
supervisor. The only guidance is one sentence in `docs/MIGRATING-0.19.md`
§ 8. A section in `docs/CHAIN-AUTHORING.md` beside `supervisorPolicy`: what
one tick holds (an agent, plus a judge suite under the ship lock), how wave
width and `maxTicks` multiply, and this repo's own measured edge (two
four-wide waves on an 11 GB host) as the worked example.
