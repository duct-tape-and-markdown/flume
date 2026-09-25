# The verdict records agent duration but not gate or merge duration; log lines carry no timestamp

Downstream field report, 0.19: non-agent time was invisible. This repo
measured the same blind spot by differencing verdict timestamps (median 6.7
minutes of non-agent overhead per wave). Suggested and taken as
straightforward: each gate result and each merge outcome on the tick
verdict carries its duration, and every `[flume]` log line carries an
instant. Facts the engine already holds at the moment it logs. File it.
