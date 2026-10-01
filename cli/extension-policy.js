'use strict';
// The desktop catalog stays intact. CLI distribution is an explicit capability allowlist.
const plugins = new Set([
  'achernar-context7',
  'achernar-git-tools',
  'achernar-json-tools',
  'achernar-package-tools',
  'achernar-project-tools',
  'achernar-runtime-checks',
  'achernar-web-search',
]);
const skills = new Set([
  'achernar-architecture',
  'achernar-code-review',
  'achernar-codebase-inspection',
  'achernar-debugging',
  'achernar-electron-ui',
  'achernar-ui-design',
  'achernar-implementation',
  'achernar-mcp-development',
  'achernar-product-planning',
  'achernar-security',
  'achernar-verification',
  'achernar-web-research',
  'achernar-coding',
]);
function isCliExtension(entry) {
  return (
    entry.source === 'Achernar Project' &&
    (entry.kind === 'plugins' ? plugins : skills).has(entry.name)
  );
}
module.exports = { isCliExtension };
