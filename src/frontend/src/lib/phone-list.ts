import { isEmergencyDestination } from "./emergency-numbers";

export const MAX_BATCH_NUMBERS = 100;
export const MAX_PHONE_LIST_BYTES = 64 * 1024;

export interface PhoneListIssue {
  row: number;
  value: string;
  reason: string;
}

export interface PhoneListPreview {
  phones: string[];
  duplicates: number;
  issues: PhoneListIssue[];
  error: string | null;
}

const PHONE_HEADERS = new Set([
  "phone",
  "phones",
  "number",
  "numbers",
  "phonenumber",
  "recipient",
  "recipientphone",
  "recipientphonenumber",
  "telephone",
  "mobile",
]);

/** Parse quoted CSV/TSV locally. Importing or previewing never places a call. */
function readRows(source: string): Array<{ row: number; cells: string[] }> {
  const firstLine = source.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const rows: Array<{ row: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let rowStart = 1;

  const finishCell = () => {
    cells.push(cell.trim());
    cell = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (cells.some(Boolean)) rows.push({ row: rowStart, cells });
    cells = [];
    if (rows.length > 1000)
      throw new Error(
        "The list has too many rows. Split it into lists of up to 100 numbers.",
      );
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        cell += char;
        if (char === "\n") line += 1;
      }
    } else if (char === delimiter) {
      finishCell();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
      line += 1;
      rowStart = line;
    } else if (char === '"') {
      if (cell.trim() || closedQuote)
        throw new Error(
          `Unexpected quote on row ${line}. Check the CSV format.`,
        );
      cell = "";
      quoted = true;
    } else if (closedQuote && char.trim()) {
      throw new Error(
        `Unexpected text after a quote on row ${line}. Check the CSV format.`,
      );
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("An opening CSV quote has no closing quote.");
  finishRow();
  return rows;
}

export function parsePhoneList(source: string): PhoneListPreview {
  const result: PhoneListPreview = {
    phones: [],
    duplicates: 0,
    issues: [],
    error: null,
  };
  if (new TextEncoder().encode(source).length > MAX_PHONE_LIST_BYTES) {
    result.error =
      "The list is too large. Use a CSV or text file smaller than 64 KB.";
    return result;
  }
  try {
    const rows = readRows(source.replace(/^\uFEFF/, ""));
    if (!rows.length) return result;
    const phoneColumns = rows[0].cells
      .map((cell, index) =>
        PHONE_HEADERS.has(cell.toLowerCase().replace(/[\s_-]/g, ""))
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    if (phoneColumns.length > 1) {
      result.error =
        "The CSV has multiple phone columns. Keep one column named phone.";
      return result;
    }
    const phoneColumn = phoneColumns[0];
    const dataRows = phoneColumn !== undefined ? rows.slice(1) : rows;
    if (
      phoneColumn === undefined &&
      rows.some(({ cells }) => cells.length > 1) &&
      rows.some(({ cells }) =>
        cells.some((cell) => !/^[+\d\s().-]+$/.test(cell)),
      )
    ) {
      result.error =
        "For a CSV with names or other fields, add a header named phone to the number column.";
      return result;
    }
    const seen = new Set<string>();
    for (const { row, cells } of dataRows) {
      const values =
        phoneColumn !== undefined ? [cells[phoneColumn] ?? ""] : cells;
      for (const value of values) {
        // Country codes must be explicit; never guess a country or strip an extension.
        const phone = value.replace(/[\s().-]/g, "");
        let reason: string | null = null;
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
          reason =
            "Use + and a country code, with 8–15 digits and no extension.";
        } else if (isEmergencyDestination(phone)) {
          reason =
            "Emergency, crisis, and police dispatch numbers are blocked.";
        }
        if (reason) {
          result.issues.push({ row, value: value.slice(0, 80), reason });
        } else if (seen.has(phone)) {
          result.duplicates += 1;
        } else {
          seen.add(phone);
          result.phones.push(phone);
        }
      }
    }
    if (result.phones.length > MAX_BATCH_NUMBERS) {
      result.error = `This list has ${result.phones.length} unique valid numbers. Split it into batches of at most ${MAX_BATCH_NUMBERS}.`;
    }
  } catch (error) {
    result.error =
      error instanceof Error
        ? error.message
        : "Unable to read the number list.";
  }
  return result;
}
