const FORMULA_INJECTION_RE = /^[=+\-@\t\r]/;

/** Prefix user-controlled Excel strings so they cannot be interpreted as formulas. */
export function sanitizeExcelText(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (FORMULA_INJECTION_RE.test(text)) return `'${text}`;
  return text;
}

export function isExcelFormulaInjectionRisk(value: unknown): boolean {
  if (value == null) return false;
  return FORMULA_INJECTION_RE.test(String(value));
}
