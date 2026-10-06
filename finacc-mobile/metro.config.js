const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// وحدات node مطلوبة داخل ملفات sql.js (ناتج emscripten) — تُستبدل بوحدات فارغة
// عند التحزيم للويب فقط، ولا تؤثر على أي حزمة أخرى خارج node_modules/sql.js.
const NODE_BUILTINS = ['fs', 'path', 'crypto', 'os', 'module', 'url', 'util', 'assert'];
const baseResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const issuer = context.originModule && context.originModule.filePath ? context.originModule.filePath : '';
  if (issuer.includes('sql.js') && NODE_BUILTINS.includes(moduleName)) {
    return { type: 'empty' };
  }
  if (baseResolveRequest) {
    return baseResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
