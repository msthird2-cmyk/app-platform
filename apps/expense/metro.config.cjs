const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Monorepo setup: pnpm keeps real package directories in the workspace root's
 * store and symlinks them into each package, so Metro has to watch the root and
 * be told exactly which node_modules directories to search.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Hierarchical lookup stays ON: pnpm keeps each package's own dependencies
// beside it in the store, and only walking up from the importing file finds them.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
