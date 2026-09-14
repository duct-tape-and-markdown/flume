/**
 * Substituted content is data, never prompt syntax.
 *
 * The engine's render pipeline substitutes `{{KEY}}` values and then scans
 * the result for inline-exec spans (`spec/prompt.md`, *The render
 * pipeline*), so a cited spec section, a queue entry, or a diff that quotes
 * the span grammar would execute as a command and refuse the render — the
 * wall a build tick hit the first time an entry cited the section that
 * documents the grammar. Every value the package substitutes passes through
 * here first.
 *
 * The break is a zero-width space between the bang and the backtick: the
 * engine's span grammar admits only whitespace there and U+200B is not
 * whitespace to it, so the span is inert, while the bytes the agent reads are
 * visually the quoted text. Interim by declaration: `spec/prompt.md`, *The
 * render pipeline* names the engine's `Phase.promptDataKeys`, under which the
 * engine neutralizes declared keys itself; the package declares its keys and
 * this module goes the tick that ships.
 */

const SPAN_OPENER = /!(\s*)`/g;

/** The text with every span opener made inert; a value with none is returned as-is. */
export function defuseSpans(value: string): string {
  return value.replace(SPAN_OPENER, "!​$1`");
}

/** Every value of a prompt-args map, defused. */
export function defuseArgs(args: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, defuseSpans(value)]));
}
