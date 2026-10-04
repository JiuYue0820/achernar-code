const path = require('node:path');
require('../src/services/cli-package').buildCliPackage(path.resolve(__dirname, '..'), path.resolve(process.argv[2] || 'outputs/achernar-code.zip'))
  .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
