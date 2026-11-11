import { normalizeAttendanceFlagName } from './attendanceFlags.js';

// Count one overall result per exported attendance record, never checkpoints.
export function summarizeAttendanceStatuses(rows, getStatus) {
  const counts = new Map();
  for (const row of rows) {
    const label = normalizeAttendanceFlagName(getStatus(row)) || 'Pending';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const order = ['Absent', 'Present', 'Late', 'Partial Attendance', 'Pending', 'Upcoming', 'On Leave', 'Substituted'];
  return [...counts.entries()]
    .sort(([left], [right]) => {
      const leftIndex = order.indexOf(left);
      const rightIndex = order.indexOf(right);
      return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex)
        || left.localeCompare(right);
    })
    .map(([label, count]) => ({ label, count }));
}

export function attendanceStatusSummaryText(summary) {
  return summary.map(({ label, count }) => `${label} = ${count}`).join(' | ');
}

// Match the soft background and text colors of the attendance status badges.
const STATUS_COLORS = {
  Present: { text: '166534', background: 'DCFCE7' },
  Absent: { text: '991B1B', background: 'FEE2E2' },
  Late: { text: '92400E', background: 'FEF3C7' },
  'Partial Attendance': { text: '6D28D9', background: 'EDE9FE' },
  Pending: { text: '9A3412', background: 'FFEDD5' },
  Upcoming: { text: '334155', background: 'F1F5F9' },
  'On Leave': { text: '155E75', background: 'CFFAFE' },
  Substituted: { text: '3730A3', background: 'E0E7FF' },
};

export function attendanceStatusSummaryHtml(summary) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  return summary.map(({ label, count }) => {
    const colors = STATUS_COLORS[label] || { text: '374151', background: 'F3F4F6' };
    return `<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 5px;border-radius:3px;font-weight:700;color:#${colors.text};background:#${colors.background}">${escape(label)} = ${count}</span>`;
  }).join('');
}

export function buildAttendanceExcelWorksheet(XLSX, sourceRows, dataRows, headings) {
  const sourceHeader = sourceRows.length - dataRows.length - 1;
  const columnCount = headings.length;
  const labelColumns = Math.max(1, Math.min(3, Math.floor(columnCount / 4)));
  const metadata = sourceRows.slice(0, sourceHeader).flatMap((row) => row[0] === 'Generated' && row[3] === 'Records'
    ? [['Generated', row[1]], ['Records', row[4]]]
    : [row]);
  const statusHeading = metadata.findIndex((row) => row[0] === 'Overall status totals');
  const compactCount = (row, index) => typeof row[1] === 'number'
    && ((statusHeading >= 0 && index > statusHeading) || ['Records', 'Total late minutes'].includes(row[0]));
  const displayMetadata = metadata.map((row, index) => compactCount(row, index) ? [`${row[0]} - ${row[1]}`] : row);
  const rows = displayMetadata.map((row) => {
    if (row.length < 2) return row;
    const formatted = Array(labelColumns + 1).fill('');
    formatted[0] = row[0]; formatted[labelColumns] = row[1];
    return formatted;
  });
  const merges = [];
  const headingRows = [];
  const merge = (r, first, last) => { if (last > first) merges.push({ s: { r, c: first }, e: { r, c: last } }); };
  displayMetadata.forEach((row, index) => {
    if (!row.length) return;
    if (row.length === 1) {
      merge(index, 0, columnCount - 1);
      if (!compactCount(metadata[index], index)) headingRows.push(index);
    }
    else { merge(index, 0, labelColumns - 1); merge(index, labelColumns, columnCount - 1); }
  });
  const headerRowIndex = rows.length;
  headingRows.push(headerRowIndex);
  rows.push(headings, ...dataRows);
  return { ws: XLSX.utils.aoa_to_sheet(rows), rows, merges, headerRowIndex, headingRows, valueColumn: 'A' };
}

export function attendanceWorkbookBytes(XLSX, workbook, summary, firstStatusRow, valueColumn = 'B', headingRows = []) {
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  if (!summary.length) return bytes;
  // The bundled SheetJS writer omits custom cell colors. Add styles to the
  // generated OOXML package using its bundled ZIP API; keep cell data/widths intact.
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const readXml = (path) => {
    const entry = XLSX.CFB.find(zip, '/' + path);
    if (!entry) throw new Error('Excel export is missing ' + path);
    return decoder.decode(entry.content);
  };
  let styles = readXml('xl/styles.xml');
  let worksheet = readXml('xl/worksheets/sheet1.xml');
  const append = (tag, elements) => {
    const opening = new RegExp(`<${tag}\\b[^>]*\\bcount="(\\d+)"[^>]*>`);
    const match = styles.match(opening);
    if (!match) throw new Error('Excel export has no ' + tag + ' styles');
    const start = Number(match[1]);
    styles = styles.replace(opening, match[0].replace(/count="\d+"/, `count="${start + elements.length}"`))
      .replace(`</${tag}>`, elements.join('') + `</${tag}>`);
    return start;
  };
  const colors = [...summary.map(({ label }) => STATUS_COLORS[label] || { text: '374151', background: 'F3F4F6' }), { text: 'FFFFFF', background: '15803D' }];
  const firstFont = append('fonts', colors.map((color) => `<font><b/><sz val="11"/><color rgb="FF${color.text}"/><name val="Calibri"/></font>`));
  const firstFill = append('fills', colors.map((color) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color.background}"/><bgColor indexed="64"/></patternFill></fill>`));
  const firstStyle = append('cellXfs', colors.map((_, index) => `<xf numFmtId="0" fontId="${firstFont + index}" fillId="${firstFill + index}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`));
  summary.forEach((_, index) => {
    for (const column of new Set(['A', valueColumn])) {
      const address = `${column}${firstStatusRow + index + 1}`;
      const cell = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>`);
      if (!cell.test(worksheet)) throw new Error('Excel status summary cell is missing: ' + address);
      worksheet = worksheet.replace(cell, (opening) => opening.replace(/\s+s="\d+"/, '').replace(/>$/, ` s="${firstStyle + index}">`));
    }
  });
  for (const rowIndex of headingRows) {
    const rowNumber = rowIndex + 1;
    const cells = new RegExp(`<c\\b[^>]*\\br="[A-Z]+${rowNumber}"[^>]*>`, 'g');
    worksheet = worksheet.replace(cells, (opening) => opening.replace(/\s+s="\d+"/, '').replace(/>$/, ` s="${firstStyle + summary.length}">`));
  }
  XLSX.CFB.utils.cfb_add(zip, '/xl/styles.xml', encoder.encode(styles));
  XLSX.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', encoder.encode(worksheet));
  return new Uint8Array(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip', compression: true }));
}

export function downloadAttendanceWorkbook(XLSX, workbook, filename, summary, firstStatusRow, valueColumn = 'B', headingRows = []) {
  if (!summary.length) { XLSX.writeFile(workbook, filename); return; }
  const bytes = attendanceWorkbookBytes(XLSX, workbook, summary, firstStatusRow, valueColumn, headingRows);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
