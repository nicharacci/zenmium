export interface ImportedBookmark { key: number; parentKey: number | null; title: string; url?: string }
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const decodeHtml = (s: string) => s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|#39);/gi, (_all, value: string) => {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (value[0] !== "#") return entities[value.toLowerCase()] ?? "";
  const point = value[1]?.toLowerCase() === "x" ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10);
  return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
});

/** Netscape bookmark HTML is parsed as data, never rendered or executed. */
export function importBookmarks(html: string): ImportedBookmark[] {
  if (html.length > 10 * 1024 * 1024) throw new Error("Bookmark import is limited to 10 MB.");
  const items: ImportedBookmark[] = [];
  const parents: Array<number | null> = [null];
  let pending: number | null = null;
  const tokens = html.matchAll(/<h3\b[^>]*>([^]*?)<\/h3\s*>|<a\b([^>]*?)>([^]*?)<\/a\s*>|<\/?dl\b[^>]*>/gi);
  for (const token of tokens) {
    if (items.length >= 10000) throw new Error("Bookmark import is limited to 10,000 entries.");
    const title = decodeHtml((token[1] ?? token[3] ?? "").replace(/<[^>]*>/g, "")).trim().slice(0, 500);
    if (token[1] !== undefined) {
      pending = items.length;
      items.push({ key: pending, parentKey: parents.at(-1) ?? null, title: title || "Folder" });
    } else if (token[2] !== undefined) {
      const attr = token[2].match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const raw = decodeHtml(attr?.[1] ?? attr?.[2] ?? attr?.[3] ?? "");
      try {
        const url = new URL(raw);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
        items.push({ key: items.length, parentKey: parents.at(-1) ?? null, title: title || url.hostname, url: url.href });
      } catch { /* Invalid or unsafe links are not imported. */ }
    } else if (/^<\/dl/i.test(token[0])) {
      if (parents.length > 1) parents.pop();
    } else {
      if (parents.length >= 100) throw new Error("Bookmark folders are nested too deeply.");
      parents.push(pending ?? parents.at(-1) ?? null);
      pending = null;
    }
  }
  return items;
}

export function exportBookmarks(items: { id: string; parentId: string | null; title: string; url?: string }[]): string {
  const visited = new Set<string>();
  const render = (parentId: string | null): string => items.filter((item) => item.parentId === parentId).map((item) => {
    if (visited.has(item.id)) return "";
    visited.add(item.id);
    if (item.url) return `<DT><A HREF="${escapeHtml(item.url)}">${escapeHtml(item.title)}</A>`;
    return `<DT><H3>${escapeHtml(item.title)}</H3>\n<DL><p>\n${render(item.id)}\n</DL><p>`;
  }).join("\n");
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Zennium bookmarks</TITLE>\n<H1>Zennium bookmarks</H1>\n<DL><p>\n${render(null)}\n</DL><p>\n`;
}
