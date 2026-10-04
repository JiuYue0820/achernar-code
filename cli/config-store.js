'use strict';
const fs = require('node:fs');
/** Cache parsed configuration by file identity; external edits invalidate it. */
function createConfigReader(file) {
  let revision, saved;
  return () => {
    let stat;
    try {
      stat = fs.statSync(file, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        revision = null;
        saved = {};
        return {};
      }
      throw error;
    }
    const next = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    if (revision !== next) {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      revision = next;
    }
    return structuredClone(saved);
  };
}
module.exports = { createConfigReader };
