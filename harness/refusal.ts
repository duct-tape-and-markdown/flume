/**
 * How the harness package refuses an artifact it cannot read: strictly, and
 * by field name.
 *
 * Two surfaces refuse this way — the declaration a consumer writes
 * (`spec/harness.md`, *What a consumer declares*) and the plan state a tick
 * writes (*Plan state as declared state*) — and both want the same three
 * properties. A field the package never reads is a belief about the
 * environment that nothing honours; a required one silently defaulted is
 * that belief inverted; and either, reported as "expected object, received
 * object", is a message nobody can act on. Refusal names the dotted path of
 * every field at fault, and for an unrecognized key the valid set beside it
 * (`.claude/rules/engineering.md`, *Loud or nothing*).
 *
 * One home rather than a copy per artifact: the refusal's vocabulary is a
 * detection a sibling surface already performs, and re-deriving it beside
 * the next artifact is how two schemas come to disagree about what a missing
 * field sounds like (`.claude/rules/engineering.md`, *The fix lands at the
 * mechanism*).
 */

import { z } from "zod";

/**
 * Builds a strict object whose unrecognized-key refusal carries its own
 * valid set. One home for the refusal's vocabulary, so a nested object
 * names its own fields rather than the outermost one's — zod consults the
 * innermost schema's error first, and the issue's path locates it.
 *
 * Every other issue falls through to zod's own message; only the valid set
 * is knowledge this helper holds.
 */
export const strict = <T extends z.ZodRawShape>(shape: T) => {
  const valid = Object.keys(shape).join(", ");
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `valid fields are: ${valid}`
        : undefined,
  });
};

/** The value at `path` in `root`, or `undefined` if any step is absent. */
const valueAt = (root: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (node, key) =>
      node === null || node === undefined
        ? undefined
        : (node as Record<PropertyKey, unknown>)[key],
    root,
  );

/**
 * One line per issue, each opening with the dotted path of the field it is
 * about — the field name is the part a consumer acts on, so it leads.
 *
 * An unrecognized key is reported at the key itself rather than at the
 * object holding it, and a missing field is told apart from a malformed one
 * by reading the input at the issue's path, never by matching zod's prose.
 */
const fieldLines = (
  input: unknown,
  issues: readonly z.core.$ZodIssue[],
): string[] =>
  issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map(
        (key) =>
          `${[...issue.path, key].join(".")}: unknown field — ${issue.message}`,
      );
    }
    const path = issue.path.join(".");
    if (valueAt(input, issue.path) !== undefined) {
      return [`${path}: ${issue.message}`];
    }
    // Absent, so absence leads. A refinement that fired on the absence
    // already said why it mattered; zod's own "expected X, received
    // undefined" adds nothing the path has not.
    return [
      issue.code === "custom"
        ? `${path}: required field is missing — ${issue.message}`
        : `${path}: required field is missing`,
    ];
  });

/**
 * Parse `value` against `schema`, or throw naming `subject` and every field
 * at fault.
 *
 * Throws rather than returning a verdict: every caller is reading an
 * artifact it is about to act on, and a caller holding a half-read one is
 * the degraded-but-proceeding path the posture refuses. `subject` is the
 * artifact in the reader's words — "harness declaration", "plan state at
 * <path>" — so the first line says what failed to load before the field
 * lines say why.
 */
export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  subject: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const lines = fieldLines(value, result.error.issues);
  throw new Error(
    `invalid ${subject}:\n${lines.map((line) => `  ${line}`).join("\n")}`,
  );
}
