const fs = require('fs');
const XLSX = require('xlsx');

const workbook = XLSX.readFile('C:/Users/Lenovo/OneDrive/Desktop/U&I/Danh Sách Vị Trí Có Hàng  Admin UI.xlsx');
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });

const parseNumber = (value) => {
  const parsed = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeLocation = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^\s*(?:6)?(\d{3})-(\d{1,3})-(\d)-([A-C])\s*$/i);
  if (!match) return null;
  const [, rowPart, framePart, levelPart, positionPart] = match;
  const row = Number(rowPart);
  const frame = Number(framePart);
  const level = Number(levelPart);
  const position = positionPart.toUpperCase();
  return {
    raw,
    row,
    frame,
    level,
    position,
    id: `${row}-${String(frame).padStart(2, '0')}-${level}${position}`,
  };
};

const byId = new Map();
for (const row of rows.slice(1)) {
  const rawLocation = row.__EMPTY_3 || row['Vị Trí'] || row['__EMPTY_3'];
  const normalized = normalizeLocation(rawLocation);
  if (!normalized) continue;

  const productCode = row.__EMPTY_1 || '';
  const productName = row.__EMPTY_2 || '';
  const supplier = row.__EMPTY_12 || '';
  const palletNote = String(row.__EMPTY_8 || '').trim();
  const quantity = row.__EMPTY_5 || '';
  const packageCount = parseNumber(row.__EMPTY_4);
  const cbm = parseNumber(row.__EMPTY_19);
  const grossWeightKg = parseNumber(row.__EMPTY_20);
  const netWeightKg = parseNumber(row.__EMPTY_21);
  const status = 'OCCUPIED';

  if (!byId.has(normalized.id)) {
    byId.set(normalized.id, {
      id: normalized.id,
      row: normalized.row,
      frame: normalized.frame,
      level: normalized.level,
      position: normalized.position,
      rawLocation: normalized.raw,
      productCode,
      productName,
      supplier,
      palletNote,
      quantity,
      packageCount,
      cbm,
      grossWeightKg,
      netWeightKg,
      status,
    });
  }
}

const dataset = Array.from(byId.values()).sort((a, b) => {
  if (a.row !== b.row) return a.row - b.row;
  if (a.frame !== b.frame) return a.frame - b.frame;
  return a.level - b.level;
});

const out = `export const ADMIN_UI_OCCUPIED_LOCATIONS = ${JSON.stringify(dataset, null, 2)}\n`;
fs.writeFileSync('src/data/adminUiOccupiedLocations.js', out);
console.log('uniqueLocations', dataset.length);
console.log('sample', dataset.slice(0, 5));
