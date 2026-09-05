// Metro config for a pnpm monorepo: watch the repo root and resolve hoisted deps.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
// Watch the whole workspace and let Metro follow pnpm's symlinks (hierarchical
// lookup stays ON so peer deps in the .pnpm store resolve correctly).
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
