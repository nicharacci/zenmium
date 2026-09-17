/** Only ordinary credential-free web URLs may enter OS browser dispatch. */
export function webUrl(input: string): string | null {
  if (input.length > 16384 || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function secureOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
export function externalApplicationUrl(input: string): string | null {
  if (input.length > 8192 || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    return ["mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
