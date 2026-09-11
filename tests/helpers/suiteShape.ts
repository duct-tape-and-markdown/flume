/**
 * The reader the scanner-extraction pin is judged by: what the
 * retired-narration suite imports from `tests/helpers/`, and what grammar it
 * still declares itself.
 *
 * `.flume/vitestJudge.ts` proves a fix red on the base by laying the merged
 * bytes of each file holding a named test over the pre-fix tree. That copy is
 * the suite file — so a grammar declared inside it rides forward and the fix
 * is green on both sides, while a grammar imported from here is read at its
 * base version and goes red as it should. This module reads which of the two
 * the suite is doing.
 */
import { join } from "node:path";

import { readDoc } from "./scanCorpus.ts";

/** The suite whose scanners this pin holds. */
export const SUITE_PATH = join("tests", "retired-narration.test.ts");

/** What `text` imports from `./helpers/…`, one entry per module. */
export function helperImports(text: string): { module: string; names: string[] }[] {
  const out: { module: string; names: string[] }[] = [];
  for (const m of text.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"\.\/helpers\/([\w.-]+)\.ts"/g,
  )) {
    const names = m[1]!
      .split(",")
      .map((part) => {
        const spec = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
        return (spec[0] ?? "").trim();
      })
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    out.push({ module: m[2]!, names });
  }
  return out;
}

/**
 * Grammar `text` declares for itself: a `function` declaration, or a `const`
 * bound directly to an arrow function, at the suite's top level or at a
 * `describe` body's. Indentation is the bound, and it is the right one: a
 * scanner is declared where its `describe` can reach it (column 0 or 2),
 * while a driver an `it` builds for one assertion sits deeper and is the
 * test's own — it is *meant* to ride forward with the file.
 *
 * Returned as the declared names, so a failure names what is left rather
 * than only counting it.
 */
export function declaredGrammar(text: string): string[] {
  const heads = [
    /^ {0,2}(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /^ {0,2}(?:const|let)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=]*)?\s*=\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)(?:\s*:[^=]*)?\s*=>/,
  ];
  return text
    .split("\n")
    .flatMap((line) => heads.flatMap((re) => [...(re.exec(line)?.slice(1, 2) ?? [])]));
}

/** The suite's source, as the pin reads it off disk. */
export const suiteSource = (): string => readDoc(SUITE_PATH);
