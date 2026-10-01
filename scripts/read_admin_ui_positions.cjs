const XLSX = require('xlsx');
const path = 'C:/Users/Lenovo/OneDrive/Desktop/U&I/Danh Sách Vị Trí Có Hàng  Admin UI.xlsx';

const workbook = XLSX.readFile(path);
console.log('SHEETS', workbook.SheetNames);

for (const name of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '', raw: false });
  console.log('SHEET', name, 'rowCount', rows.length);
  console.log(JSON.stringify(rows.slice(0, 15), null, 2));
  console.log('---');
}
