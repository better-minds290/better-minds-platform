import { isExcelFormulaInjectionRisk, sanitizeExcelText } from "./excelSanitize";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(sanitizeExcelText("=SUM(1)"), "'=SUM(1)", "=SUM(1)");
assertEqual(sanitizeExcelText("=HYPERLINK(\"http://evil\",\"x\")"), "'=HYPERLINK(\"http://evil\",\"x\")", "=HYPERLINK");
assertEqual(sanitizeExcelText("+1"), "'+1", "+1");
assertEqual(sanitizeExcelText("-1"), "'-1", "-1");
assertEqual(sanitizeExcelText("@foo"), "'@foo", "@foo");
assertEqual(sanitizeExcelText("\tformula"), "'\tformula", "tab prefix");
assertEqual(sanitizeExcelText("\r=cmd"), "'\r=cmd", "carriage-return prefix");
assertEqual(sanitizeExcelText("Nguyễn Thị Ánh"), "Nguyễn Thị Ánh", "Vietnamese name unchanged");
assertEqual(sanitizeExcelText("learner@better-minds.vn"), "learner@better-minds.vn", "normal email unchanged");
assertEqual(sanitizeExcelText(""), "", "empty string");
assertEqual(sanitizeExcelText(null), "", "null");
assertEqual(isExcelFormulaInjectionRisk("=SUM(1)"), true, "risk: formula");
assertEqual(isExcelFormulaInjectionRisk("Nguyễn"), false, "risk: vietnamese");

console.log("excelSanitize tests passed");
