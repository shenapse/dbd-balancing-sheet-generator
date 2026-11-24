/**
 * Canonical name key: fold accents (NFKD, like dbd-assets slugs), lowercase, and strip whitespace
 * and `- _ ' . & "` plus typographic quotes.
 */
export function normalize(s: string): string {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\-_'.&"’‘“”]+/g, '');
}
