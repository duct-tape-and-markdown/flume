/**
 * `flume friction` — the declared friction channel read out, whole or one
 * note at a time (spec/cli.md, *Subcommand surface*).
 *
 * This verb moves bytes and never derives meaning from them: the engine's
 * lifecycle guarantee over the channel (spec/chain.md, "Chain.friction — the
 * declared friction channel") is interpretation-freedom, not read-freedom.
 * What counts as a note is the channel's one listing (`frictionNotes`,
 * `src/friction.ts`), never a predicate of this verb's own, so this list and
 * the `friction: N` line `flume status` prints can never disagree.
 */

import { readFileSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { loadChainOrRefuse } from "./cliChainLoad.js";
import { EX_IOERR } from "./exitCodes.js";
import type { FlumePaths } from "./flumeApi.js";
import { frictionNotes } from "./friction.js";
import { namespacedJoin } from "./paths.js";

export async function frictionVerb(
  paths: FlumePaths,
  rest: string[],
): Promise<number> {
  const { flumeDir } = paths;
  const name = rest[0];
  if (rest.length > 1) {
    console.error("usage: flume friction [name]");
    return 2;
  }

  // The shared refusing load (`loadChainOrRefuse`, src/cliChainLoad.ts):
  // the CJS refusal, the failure line and the mount-dead code have one
  // home, and this verb supplies only the name it reports under.
  const loaded = await loadChainOrRefuse(paths, "friction");
  if (!loaded.chain) return loaded.exitCode;
  const chain = loaded.chain;

  // Output is never interpreted — the engine's lifecycle guarantee over
  // the channel (spec/chain.md, "Chain.friction — the declared friction
  // channel") is interpretation-freedom, not read-freedom (spec/cli.md,
  // "Subcommand surface"); this verb only moves bytes, it never derives
  // meaning from them.
  if (chain.friction === undefined) {
    console.error(
      "[flume] friction refuses: this chain does not declare Chain.friction",
    );
    return 2;
  }
  const frictionDir = join(flumeDir, chain.friction);

  if (name !== undefined) {
    // A user-supplied name must name a direct child of the declared dir —
    // the same scope the bare list enumerates and --help documents. This
    // also rejects a "../" escape the same shape validateFrictionDeclaration
    // (loadChainModule) already refuses for the chain's own declaration;
    // a nested path is refused identically, not resolved.
    const candidate = resolve(frictionDir, name);
    const isDirectChild = dirname(candidate) === resolve(frictionDir);
    let bytes: Buffer | undefined;
    if (isDirectChild) {
      try {
        // What counts as a note is the channel's **one** listing,
        // `frictionNotes` (`src/friction.ts`) — never a second predicate
        // spelled beside it (`.claude/rules/engineering.md`, "The fix lands
        // at the mechanism"). The listing skips a dot-prefixed name and
        // admits only a file, so a placeholder, a subdirectory, and a name
        // nothing stands at all reach the one `no note named` arm below —
        // exactly the disposition the help page states.
        // A predicate of this verb's own answered the first two differently
        // from the list it claims to read: a subdirectory it could not
        // classify fell through to the read and exited `EX_IOERR` over a
        // channel that was perfectly readable.
        //
        // The absence that arm reports is **proven**, never read off an
        // errno: the listing descends from the state root this verb
        // resolved down to the declared channel, asserting each rung a
        // directory, so a channel a plain file stands at refuses on every
        // host. One stat could not say that — win32 answers a path through
        // a non-directory `ENOENT` (`.claude/rules/platform-facts.md`,
        // *win32 reports a path through a non-directory as not found*), so
        // an errno-keyed silent arm would report the note absent over an
        // unresolved channel there while posix refused on the same tree
        // (`.claude/rules/engineering.md`, "Loud or nothing"). That
        // refusal carries no errno and lands in the catch below; a channel
        // that is genuinely absent is the listing's empty answer, and
        // naming a note in it reads as no such note.
        //
        // Past the listing, every failure is loud, `ENOENT` included: the
        // listing has already said this name is a note, so a read that
        // cannot produce its bytes is a note that vanished or is
        // unreadable mid-verb — an unresolved input, not a legitimate
        // absence. The bare list's per-row stat refuses on the same
        // footing for the same reason.
        const notes = frictionNotes(flumeDir, frictionDir);
        const noteName = basename(candidate);
        if (notes.includes(noteName))
          bytes = readFileSync(namespacedJoin(frictionDir, noteName));
      } catch (err) {
        console.error(
          `[flume] friction: '${name}' failed to read: ${err instanceof Error ? err.message : String(err)}`,
        );
        return EX_IOERR;
      }
    }
    if (bytes === undefined) {
      console.error(
        `[flume] friction: no note named '${name}' in '${chain.friction}'`,
      );
      return 2;
    }
    process.stdout.write(bytes);
    return 0;
  }

  // What the channel holds is the engine's one listing, `frictionNotes`
  // (`src/friction.ts`) — not a walk of this verb's own, so this list and
  // the `friction: N` line `flume status` prints can never disagree.
  // A declared-but-absent dir is that listing's empty answer and lists
  // empty here (spec/cli.md): the directory is created lazily by whichever
  // engine write needs it first, so its absence is a legitimate, silent,
  // zero-note state. Every other listing failure throws, and this verb
  // refuses on it.
  let files: string[];
  try {
    files = frictionNotes(flumeDir, frictionDir);
  } catch (err) {
    console.error(
      `[flume] friction: '${chain.friction}' failed to read: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EX_IOERR;
  }
  // Every row is stat'd before any is printed: a half-list on stdout
  // followed by a refusal on stderr reads, to anything redirecting the
  // list, as a complete channel. A note readdir enumerated but stat cannot
  // see is an unresolved input, ENOENT included — unlike the dir itself
  // above, absence here is a note that vanished mid-list, never a
  // legitimate zero state — so this arm refuses on any stat failure with
  // the same EX_IOERR the readdir and named-note arms return.
  const rows: string[] = [];
  for (const fileName of files) {
    let stats: Stats;
    try {
      stats = statSync(namespacedJoin(frictionDir, fileName));
    } catch (err) {
      console.error(
        `[flume] friction: '${chain.friction}/${fileName}' failed to read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EX_IOERR;
    }
    rows.push(`${fileName}  ${stats.size}  ${stats.mtime.toISOString()}`);
  }
  for (const row of rows) console.log(row);
  return 0;
}
