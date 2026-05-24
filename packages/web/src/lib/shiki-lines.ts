/**
 * Extract per-line HTML fragments from a Shiki-rendered code block.
 *
 * Shiki emits `<pre class="shiki"><code><span class="line">…tokens…</span>\n
 * <span class="line">…</span>…</code></pre>` where each line contains nested
 * token spans. A naive non-greedy regex over `<span class="line">(.*?)</span>`
 * stops at the **first inner** `</span>`, capturing only the first token. Parse
 * the markup with the browser DOM so balanced nesting is handled correctly.
 */
export function extractShikiLineHtml(html: string): string[] {
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const lineEls = doc.querySelectorAll("code .line, pre .line");
      if (lineEls.length > 0) {
        return Array.from(lineEls).map((el) => (el as HTMLElement).innerHTML);
      }
    } catch {
      // fall through
    }
  }
  // SSR / no-DOM fallback: split between line spans using a balanced-ish pattern.
  const match = /<code[^>]*>([\s\S]*)<\/code>/.exec(html);
  const body = (match?.[1] ?? html).replace(/^\s*<span class="line">|<\/span>\s*$/g, "");
  return body.split(/<\/span>\s*\n\s*<span class="line">/);
}
