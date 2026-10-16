const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { contactsWorkbook, dashboardWorkbook } = require('../excel-export');

async function reopen(book) {
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(await book.xlsx.writeBuffer());
  return result;
}

test('contact XLSX preserves accents, leading zeros, long phones and literal text', async () => {
  const book = await reopen(contactsWorkbook([
    { name: 'João; "Silva"', number: '001234567890123', tags: ['Ação', 'Cliente'] },
    { name: '=1+1', number: '5511999999999' },
  ]));
  const page = book.getWorksheet('Contatos');
  assert.equal(page.getCell('A2').value, 'João; "Silva"');
  assert.equal(page.getCell('B2').value, '001234567890123');
  assert.equal(page.getCell('B2').numFmt, '@');
  assert.equal(page.getCell('C2').value, 'Ação, Cliente');
  assert.equal(page.getCell('A3').value, '=1+1');
  assert.equal(page.getCell('A3').type, ExcelJS.ValueType.String);
  assert.equal((await reopen(contactsWorkbook([]))).getWorksheet('Contatos').rowCount, 1);
});

test('dashboard XLSX contains the selected period, numeric indicators and Excel dates', async () => {
  const book = await reopen(dashboardWorkbook({
    startDate: '2026-10-01', endDate: '2026-10-02', timeZone: 'America/Sao_Paulo',
    days: 2, received: 3, sent: 1, revenue: 100.5,
    daily: [{ date: '2026-10-01', received: 3, sent: 1 }, { date: '2026-10-02', received: 0, sent: 0 }],
  }));
  assert.deepEqual(book.worksheets.map(page => page.name), ['Resumo', 'Mensagens por dia']);
  const summary = book.getWorksheet('Resumo');
  assert.equal(summary.getCell('B2').value, '2026-10-01');
  assert.equal(summary.getCell('B3').value, '2026-10-02');
  assert.equal(summary.getCell('B8').value, 100.5);
  const daily = book.getWorksheet('Mensagens por dia');
  assert.equal(daily.getCell('A2').value.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(daily.getCell('B2').value, 3);
  assert.equal(daily.getCell('B3').value, 0);
});
