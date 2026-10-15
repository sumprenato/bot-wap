const path = require('node:path');

function storageConfiguration(env = process.env, fallback = __dirname) {
  // An explicit path wins, including the isolated path passed to each chip worker.
  // Never silently relocate existing sessions when a volume is attached later.
  const directory = path.resolve(env.STORAGE_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || fallback);
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH ? path.resolve(env.RAILWAY_VOLUME_MOUNT_PATH) : null;
  const relative = volume ? path.relative(volume, directory) : null;
  const insideVolume = relative !== null && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  const railway = Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || volume);
  const problem = railway && !volume ? 'missing_volume' : railway && !insideVolume ? 'outside_volume' : null;
  return { directory, volume, insideVolume, railway, problem };
}

function resolveStorageDir(env = process.env, fallback = __dirname) {
  return storageConfiguration(env, fallback).directory;
}

function reportStorage(configuration = storageConfiguration(), report = console.warn) {
  const { directory, volume, problem } = configuration;
  if (problem === 'outside_volume') {
    report(`[STORAGE] ATENÇÃO: STORAGE_DIR=${directory} está fora do volume ${volume}. Sessões do WhatsApp e mídias podem desaparecer em um deploy. Preserve os arquivos existentes antes de corrigir o caminho.`);
  } else if (problem === 'missing_volume') {
    report('[STORAGE] ATENÇÃO: nenhum volume persistente foi detectado na Railway. PostgreSQL não armazena as credenciais do WhatsApp.');
  } else {
    report(`[STORAGE] Diretório de dados: ${directory}${volume ? ' (dentro do volume persistente)' : ' (armazenamento local)'}.`);
  }
}

module.exports = { resolveStorageDir, storageConfiguration, reportStorage };
