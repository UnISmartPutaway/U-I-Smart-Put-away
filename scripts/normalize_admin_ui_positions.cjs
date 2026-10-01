const fs = require('fs');
const XLSX = require('xlsx');

const workbook = XLSX.readFile('C:/Users/Lenovo/OneDrive/Desktop/U&I/Danh Sách Vị Trí Có Hàng  Admin UI.xlsx');
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });

const first = rows[0] || {};
console.log('KEYS', Object.keys(first));
for (let i = 0; i < 3; i += 1) {
  const row = rows[i + 1];
  if (row) console.log('ROW', i + 1, row);
}

const locKeys = Object.keys(first).filter((k) => /Vị Trí|Vị trí|position|location/i.test(String(first[k])) || k.includes('EMPTY_3'));
console.log('LOC_KEYS', locKeys);

const normalized = [];
for (const row of rows.slice(1)) {
  const positionValue = Object.entries(row).find(([key, value]) => {
    return key.includes('EMPTY_3') || /Vị Trí|Vị trí|location/i.test(String(key));
  })?.[1];
  if (positionValue) normalized.push(positionValue);
}
console.log('TOTAL_POSITIONS', normalized.length);
console.log(JSON.stringify(normalized.slice(0, 20), null, 2));
