require('dotenv').config({ quiet: true });
const { storageConfiguration, reportStorage } = require('../storage-path');

// Only inspect configuration. Do not create directories, read credentials or connect a chip.
const configuration = storageConfiguration();
reportStorage(configuration, console.log);
if (configuration.problem) process.exitCode = 1;
