/**Read all csv files correctly */
import  {readFile} from "node:fs/promises";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result.map(value =>
    value.trim().replace(/^"|"$/g, "")
  );
}


//this will retuen the row
export async function readCSV(path: string): Promise<Record<string, string>[]> {
  const content = await readFile(path, "utf-8");

  const lines = content
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCSVLine(lines[0]!);

  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);

    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}