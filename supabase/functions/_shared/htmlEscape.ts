/**
 * Canonical HTML escaper for transactional email.
 * Runtime + tests: supabase/functions/_shared/htmlEscape.ts
 * Do not copy this into src/lib.
 */

export function escapeHtml(value: unknown): string {
  const text = value == null ? "" : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
