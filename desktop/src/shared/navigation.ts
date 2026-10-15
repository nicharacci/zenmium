/** Resolve omnibox input without allowing executable or privileged schemes. */
export function resolveAddress(
  input: string,
  engine: "duckduckgo" | "google" = "duckduckgo"
): string {
  const text = input.trim();
  if (!text || text === "about:blank") return "about:blank";
  if (/^(javascript|data|file|chrome|devtools|vbscript):/i.test(text))
    throw new Error("This address cannot be opened as a browser tab.");
  if (/^https?:\/\//i.test(text)) return new URL(text).href;
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i.test(text))
    return new URL(`http://${text}`).href;
  if (/^\[[\da-f:]+\](?::\d+)?(?:[/?#]|$)/i.test(text))
    return new URL(
      `${/^\[::1\](?::\d+)?(?:[/?#]|$)/.test(text) ? "http" : "https"}://${text}`
    ).href;
  if (
    !/\s/.test(text) &&
    /^[\w\p{L}-]+(?:\.[\w\p{L}-]+)+(?::\d+)?(?:[/?#].*)?$/u.test(text)
  )
    return new URL(`https://${text}`).href;
  return `${engine === "google" ? "https://www.google.com/search?q=" : "https://duckduckgo.com/?q="}${encodeURIComponent(text)}`;
}
