/** Canonical name key: lowercase, strip whitespace and `- _ ' . & "`. Union of the legacy regexes. */
export function normalize(s: string): string {
  return String(s).toLowerCase().replace(/[\s\-_'.&"’‘“”]+/g, '');
}
