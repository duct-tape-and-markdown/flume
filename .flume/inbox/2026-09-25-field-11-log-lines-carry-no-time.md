# Field: loop log lines carry no timestamps

Downstream report, 0.19, item 11, second half. Priority 30. The verdict now
times each gate run and merge; the supervisor's own log lines still carry
no time, so an operator reading a long wave's log cannot tell when a merge
landed or how long a lock wait lasted without the verdict file. This repo's
operator measured a host sleep only by correlating rendered-prompt mtimes.

One entry: every `[flume]` line the supervisor and a tick write carries the
instant it was written, in one format, with a case over one line of each.
