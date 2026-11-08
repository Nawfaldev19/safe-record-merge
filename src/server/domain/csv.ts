/**
 * Writing CSV that is safe to open in a spreadsheet.
 *
 * Two things can go wrong with naive CSV. A value with a comma, quote or line
 * break corrupts the row unless it is quoted. And a value that starts with
 * "=", "+", "-" or "@" is run as a formula by spreadsheet programs, which lets
 * anyone who can type a name into a sign-up form run a formula on the machine
 * of whoever opens the export ("CSV injection").
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/** Escapes one value. Risky values get a leading apostrophe, which spreadsheets show as text. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One line of CSV, ending with the CRLF that RFC 4180 specifies. */
export function csvRow(values: readonly (string | number | null | undefined)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}
