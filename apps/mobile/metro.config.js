const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const sharedSources = ['../whoop/server', '../../packages/contract/src'].map((directory) => path.resolve(__dirname, directory) + path.sep);
// Gallant uses NodeNext .js specifiers for emitted server modules. Resolve its
// shared pure analytics from TypeScript when Metro bundles the native client.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (sharedSources.some((directory) => context.originModulePath.startsWith(directory)) && moduleName.startsWith('./') && moduleName.endsWith('.js')) {
    return context.resolveRequest(context, moduleName.slice(0, -3) + '.ts', platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
