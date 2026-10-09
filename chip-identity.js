const fs = require('node:fs');
const path = require('node:path');

function accountNumber(jid) {
  if (!/@s\.whatsapp\.net$/.test(String(jid || ''))) return '';
  const number = jid.split('@')[0].split(':')[0];
  return /^\d{8,15}$/.test(number) ? number : '';
}

function savedIdentity(storageDir) {
  for (const file of ['account-identity.json', 'auth_info/creds.json']) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(storageDir, file), 'utf8'));
      const number = file === 'account-identity.json' ? data.number : accountNumber(data.me?.id);
      if (/^\d{8,15}$/.test(number || '')) return number;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Não foi possível conferir a identidade salva deste chip.');
    }
  }
  return '';
}

async function bindIdentity(db, chipId, number) {
  if (!/^\d{8,15}$/.test(number || '')) throw new Error('O WhatsApp não informou um telefone válido. Gere um novo QR Code.');
  const chip = await db.get('SELECT * FROM chips WHERE id = ?', [chipId]);
  if (!chip) throw new Error('Este chip não existe mais.');
  if (chip.identity_verified && chip.number !== number) {
    throw new Error('Este chip pertence a outro número. Use a mesma conta ou crie um novo chip para conectar outro WhatsApp.');
  }
  const existing = await db.get('SELECT id FROM chips WHERE number = ? AND identity_verified = 1 AND id <> ?', [number, chipId]);
  if (existing) throw new Error('Este WhatsApp já está vinculado a outro chip.');
  try {
    // Legacy typed numbers are not identities. Release them before claiming a verified account.
    await db.run('UPDATE chips SET number = NULL WHERE number = ? AND identity_verified = 0 AND id <> ?', [number, chipId]);
    const result = await db.run('UPDATE chips SET number = ?, identity_verified = 1 WHERE id = ? AND (identity_verified = 0 OR number = ?)', [number, chipId, number]);
    if (!result.changes) throw new Error('O chip mudou durante a conexão. Tente novamente.');
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505') throw new Error('Este WhatsApp já está vinculado a outro chip.');
    throw error;
  }
  return number;
}

module.exports = { accountNumber, savedIdentity, bindIdentity };
