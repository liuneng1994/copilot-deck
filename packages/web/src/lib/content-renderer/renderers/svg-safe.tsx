import { useMemo } from "react";

/**
 * SVG preview. Browsers will execute <script> and on*= attributes inside SVG,
 * so we sanitise via DOMParser before inserting via dangerouslySetInnerHTML.
 *
 * For untrusted SVG you'd want DOMPurify; for our case (agent-produced) the
 * narrow strip-pass is good enough and avoids the extra dep.
 */
export function SvgSafe({ src, full }: { src: string; full?: boolean }) {
  const safe = useMemo(() => sanitiseSvg(src), [src]);
  return (
    <div
      className={
        full
          ? "max-h-[70vh] overflow-auto rounded-md border border-border bg-white p-3"
          : "max-h-48 overflow-auto rounded-md border border-border bg-white p-2"
      }
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised above
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

function sanitiseSvg(src: string): string {
  if (typeof DOMParser === "undefined") return "";
  try {
    const doc = new DOMParser().parseFromString(src, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") return "";

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const toRemove: Element[] = [];
    let n: Node | null = walker.currentNode;
    while (n) {
      const el = n as Element;
      const tag = el.nodeName.toLowerCase();
      if (tag === "script" || tag === "foreignobject") {
        toRemove.push(el);
      } else {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (
            name.startsWith("on") ||
            (name === "href" && attr.value.trim().toLowerCase().startsWith("javascript:")) ||
            (name === "xlink:href" && attr.value.trim().toLowerCase().startsWith("javascript:"))
          ) {
            el.removeAttribute(attr.name);
          }
        }
      }
      n = walker.nextNode();
    }
    for (const el of toRemove) el.remove();
    return root.outerHTML;
  } catch {
    return "";
  }
}
