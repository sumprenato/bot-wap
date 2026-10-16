const ExcelJS = require('exceljs');

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function workbook() {
  const book = new ExcelJS.Workbook();
  book.creator = 'Convelya';
  return book;
}

function sheet(book, name, headers, widths, rows) {
  const page = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  page.columns = headers.map((header, index) => ({ header, width: widths[index] }));
  page.addRows(rows);
  page.getRow(1).font = { bold: true, color: { argb: 'FF09291E' } };
  page.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF73DCB0' } };
  page.autoFilter = { from: { row: 1, column: 1 }, to: { row: page.rowCount, column: headers.length } };
  return page;
}

function contactsWorkbook(contacts) {
  const book = workbook();
  const page = sheet(book, 'Contatos', ['Nome', 'Telefone', 'Rótulos'], [36, 24, 45],
    contacts.map(contact => [contact.name || '', String(contact.number || ''), (contact.tags || []).join(', ')]));
  page.getColumn(2).numFmt = '@';
  return book;
}

function dashboardWorkbook(stats) {
  const book = workbook();
  const labels = {
    days: 'Dias no período', open: 'Conversas abertas', finalized: 'Conversas finalizadas',
    blocked: 'Conversas bloqueadas', awaitingReply: 'Aguardando resposta', received: 'Mensagens recebidas',
    sent: 'Mensagens enviadas', contacts: 'Contatos', messages: 'Mensagens no histórico',
    opportunities: 'Oportunidades', wonOpportunities: 'Oportunidades ganhas', revenue: 'Receita ganha', conversionRate: 'Conversão (%)',
  };
  const summary = [
    ['De', stats.startDate], ['Até', stats.endDate], ['Fuso horário', stats.timeZone],
    ...Object.entries(stats).filter(([, value]) => typeof value === 'number').map(([key, value]) => [labels[key] || key, value]),
  ];
  sheet(book, 'Resumo', ['Indicador', 'Valor'], [32, 28], summary);
  const daily = sheet(book, 'Mensagens por dia', ['Data', 'Recebidas', 'Enviadas'], [18, 18, 18],
    stats.daily.map(row => [new Date(`${row.date}T00:00:00Z`), row.received, row.sent]));
  daily.getColumn(1).numFmt = 'dd/mm/yyyy';
  return book;
}

async function sendWorkbook(res, book, filename) {
  const buffer = await book.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.type(XLSX_TYPE).send(Buffer.from(buffer));
}

module.exports = { XLSX_TYPE, contactsWorkbook, dashboardWorkbook, sendWorkbook };
