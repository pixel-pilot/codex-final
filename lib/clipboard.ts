const BLOCK_LEVEL_SELECTOR = "div,p,li,ul,ol,pre,section,article,blockquote,header,footer,main,h1,h2,h3,h4,h5,h6";

const normalizeCellText = (value: string): string => {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+$/g, "")
    .replace(/^\n+/g, "");
};

const extractCellText = (cell: Element): string => {
  const cloned = cell.cloneNode(true) as HTMLElement;

  cloned.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });

  cloned.querySelectorAll(BLOCK_LEVEL_SELECTOR).forEach((element) => {
    const ownerDocument = element.ownerDocument;
    if (!ownerDocument) {
      return;
    }

    element.appendChild(ownerDocument.createTextNode("\n"));
  });

  const textContent = cloned.textContent ?? "";
  return normalizeCellText(textContent);
};

const parseHtmlTable = (html: string): string[] => {
  if (!html || typeof DOMParser === "undefined") {
    return [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const table = doc.querySelector("table");

  if (!table) {
    return [];
  }

  const rows: string[] = [];
  table.querySelectorAll("tr").forEach((row) => {
    const cell = row.querySelector("td,th");
    if (!cell) {
      rows.push("");
      return;
    }

    rows.push(extractCellText(cell));
  });

  while (rows.length && rows[rows.length - 1] === "") {
    rows.pop();
  }

  return rows;
};

/**
 * Decodes plain-text clipboard payloads emitted by spreadsheets.
 *
 * - Treats CRLF, CR, and LF as row delimiters outside of quoted regions.
 * - Honors Excel/Sheets style quoting rules so multi-line cells remain intact.
 * - Discards content beyond the first column, matching the grid's single-column input.
 */
const parsePlainText = (text: string): string[] => {
  if (!text) {
    return [];
  }

  const rows: string[] = [];
  let buffer = "";
  let inQuotes = false;
  let ignoreRestOfRow = false;

  const pushRow = () => {
    const normalized = buffer.replace(/\u00a0/g, " ");
    rows.push(normalized);
    buffer = "";
    ignoreRestOfRow = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        if (!ignoreRestOfRow) {
          buffer += "\"";
        }
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes) {
      if (char === "\t") {
        ignoreRestOfRow = true;
        continue;
      }

      if (char === "\r") {
        if (nextChar === "\n") {
          index += 1;
        }

        pushRow();
        continue;
      }

      if (char === "\n") {
        pushRow();
        continue;
      }
    }

    if (!ignoreRestOfRow) {
      buffer += char;
    }
  }

  if (buffer.length || ignoreRestOfRow) {
    pushRow();
  }

  while (rows.length && rows[rows.length - 1] === "") {
    rows.pop();
  }

  return rows;
};

export const extractClipboardValues = (clipboardData: DataTransfer | null): string[] => {
  if (!clipboardData) {
    return [];
  }

  const htmlData = clipboardData.getData("text/html");
  const htmlValues = parseHtmlTable(htmlData);
  if (htmlValues.length) {
    return htmlValues;
  }

  const plainText = clipboardData.getData("text/plain") || clipboardData.getData("text");
  return parsePlainText(plainText ?? "");
};

export { parseHtmlTable as __parseHtmlTableForTesting, parsePlainText as __parsePlainTextForTesting };
