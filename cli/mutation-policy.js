'use strict';
/** Validate mutation paths both before asking and immediately before execution.
 * Approval and tool hooks can yield; the second check is a security boundary.
 */
async function assertMutationAllowed(environment, name, target) {
  if (name === 'files' && !['read', 'list', 'search'].includes(target.args.action))
    await environment.assertWrite(target.project, target.args.path);
  if (name === 'git' && target.args.action === 'stage')
    for (const file of target.args.paths || []) await environment.assertWrite(target.project, file);
}
module.exports = { assertMutationAllowed };
