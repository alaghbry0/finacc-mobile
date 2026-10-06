const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// وحدات node مطلوبة داخل ملفات sql.js (ناتج emscripten) — تُستبدل بوحدة فارغة
// عند التحزيم للويب والأندرويد، ولا تؤثر على أي حزمة أخرى خارج node_modules/sql.js.
// ملاحظتان:
// 1) sql.js 1.14+ يستخدم البادئة node: (node:fs بدل fs) — يشملها القائمة أدناه.
// 2) خاصية المصدر في Metro الحديثة هي context.originModulePath (نص) — مع توافق
//    مع الأشكال القديمة (originModule نص أو كائن بـ filePath).
const NODE_BUILTINS = [
  'fs', 'path', 'crypto', 'os', 'module', 'url', 'util', 'assert',
  'node:fs', 'node:path', 'node:crypto', 'node:os', 'node:module', 'node:url', 'node:util', 'node:assert',
];
const EMPTY_MODULE = path.resolve(__dirname, 'scripts/empty-module.js');
const baseResolveRequest = config.resolver.resolveRequest;

function issuerPathOf(context) {
  if (typeof context.originModulePath === 'string') return context.originModulePath;
  if (typeof context.originModule === 'string') return context.originModule;
  if (context.originModule && context.originModule.filePath) return context.originModule.filePath;
  return '';
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = issuerPathOf(context);
  if (origin.includes('sql.js') && NODE_BUILTINS.includes(moduleName)) {
    return { type: 'sourceFile', filePath: EMPTY_MODULE };
  }
  if (baseResolveRequest) {
    return baseResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
