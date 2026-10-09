const MAX_CONTACT_ROWS = 5000;

function decodeContactCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('Não foi possível ler o arquivo. Salve a planilha como CSV UTF-8.');
  }
}

// Semicolon (the panel's export) and comma CSV, including escaped quotes/newlines.
function readCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim() || text.includes('\0')) throw new Error('Selecione um arquivo CSV válido, com cabeçalho e contatos.');
  let quoted = false;
  let semicolons = 0;
  let commas = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    }
    if (!quoted) {
      if (text[i] === ';') semicolons++;
      if (text[i] === ',') commas++;
      if (text[i] === '\n' || text[i] === '\r') break;
    }
  }
  const separator = semicolons >= commas ? ';' : ',';
  const records = [];
  let row = [];
  let field = '';
  let state = 'plain';
  let line = 1;
  let startLine = 1;
  const finishRow = () => {
    row.push(field);
    if (row.some(value => value.trim())) records.push({ cells: row, line: startLine });
    if (records.length > MAX_CONTACT_ROWS + 1) throw new Error(`Importe no máximo ${MAX_CONTACT_ROWS} contatos por arquivo.`);
    row = [];
    field = '';
    state = 'plain';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else {
        field += char;
        if (char === '\n') line++;
      }
      continue;
    }
    if (char === separator) {
      row.push(field); field = ''; state = 'plain';
    } else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
      line++;
      startLine = line;
    } else if (char === '"' && !field && state === 'plain') {
      state = 'quoted';
    } else if (state === 'closed') {
      if (!/\s/.test(char)) throw new Error(`CSV inválido na linha ${line}: texto após o fechamento das aspas.`);
    } else {
      if (char === '"') throw new Error(`CSV inválido na linha ${line}: aspas no meio de um campo.`);
      field += char;
    }
  }
  if (state === 'quoted') throw new Error(`CSV inválido na linha ${startLine}: aspas não fechadas.`);
  finishRow();
  return records;
}

function parseContactCsv(text) {
  const records = readCsv(text);
  const header = records.shift()?.cells.map(value => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  const phoneIndex = header?.findIndex(value => ['telefone', 'numero', 'whatsapp', 'phone', 'number'].includes(value)) ?? -1;
  const nameIndex = header?.findIndex(value => ['nome', 'name'].includes(value)) ?? -1;
  const tagsIndex = header?.findIndex(value => ['rotulos', 'tags', 'etiquetas'].includes(value)) ?? -1;
  if (phoneIndex < 0) throw new Error('O CSV precisa de uma coluna Telefone. Nome e Rótulos são opcionais.');
  if (!records.length) throw new Error('O arquivo contém apenas o cabeçalho. Adicione ao menos um contato.');
  const contacts = new Map();
  const errors = [];
  let duplicates = 0;
  // Undo the spreadsheet-formula protection used by this panel's own exporter.
  const value = cell => String(cell || '').replace(/^'(?=[=+@\-\t\r\n])/, '').trim();
  for (const record of records) {
    const { cells, line } = record;
    const phone = value(cells[phoneIndex]);
    const number = phone.replace(/[+\s().-]/g, '');
    const name = nameIndex >= 0 ? value(cells[nameIndex]) : '';
    const tags = tagsIndex >= 0 ? [...new Set(value(cells[tagsIndex]).split(/[,|]/).map(tag => tag.trim()).filter(Boolean))] : [];
    let error = '';
    if (cells.length !== header.length) error = 'Quantidade de colunas diferente do cabeçalho.';
    else if (!/^\+?[\d\s().-]+$/.test(phone) || !/^[1-9]\d{9,14}$/.test(number)) error = 'Telefone inválido: use DDI + DDD + número, entre 10 e 15 dígitos.';
    else if (name.length > 200) error = 'Nome maior que 200 caracteres.';
    else if (tags.length > 50 || tags.some(tag => tag.length > 60)) error = 'Use até 50 rótulos de no máximo 60 caracteres.';
    if (error) { errors.push({ line, error }); continue; }
    const previous = contacts.get(number);
    if (previous) duplicates++;
    contacts.set(number, {
      number, name: name || previous?.name || '', line,
      tags: [...new Set([...(previous?.tags || []), ...tags])],
    });
  }
  return { contacts: [...contacts.values()], errors, duplicates, total: records.length };
}

module.exports = { parseContactCsv, decodeContactCsv, MAX_CONTACT_ROWS };
