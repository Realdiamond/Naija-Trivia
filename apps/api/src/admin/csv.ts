/** CSV for the console's downloads (finance's purchases, a dashboard's numbers). */

/** One cell: quoted when it must be, and text a spreadsheet would run as a formula kept as text. */
export const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const csvRow = (cells: readonly unknown[]) => cells.map(csvCell).join(',');
