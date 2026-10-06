/**
 * إضافة Expo (config plugin) لفرض RTL على الأندرويد قبل تهيئة React Native
 * (Task Android-Fix):
 * المشكلة: I18nManager.forceRTL() من JS يحتاج إعادة تحميل الحزمة ليأخذ مفعوله
 * فكان الإقلاع الأول للتطبيق LTR (واجهة معكوسة كلياً). الحل الجذري: كتابة تفضيل
 * RTL في SharedPreferences (I18nUtil) داخل MainApplication.onCreate — قبل أن
 * يقرأه React Native عند بناء الـ Host — فيقلع التطبيق RTL من أول مرة.
 *
 * تُسجَّل الإضافة في app.json (plugins) وتُطبق عند expo prebuild تلقائياً.
 */
const { withMainApplication, withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const IMPORT_LINE = 'import com.facebook.react.modules.i18nmanager.I18nUtil';
const INJECTION = [
  '    // Force RTL from the very first launch (Arabic-first app) — Task Android-Fix',
  '    I18nUtil.getInstance().allowRTL(this, true)',
  '    I18nUtil.getInstance().forceRTL(this, true)',
].join('\n');

function withForceRtlMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (!contents.includes('I18nUtil')) {
      // إدراج الاستيراد بعد آخر سطر import موجود
      const lines = contents.split('\n');
      let lastImport = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) lastImport = i;
      }
      if (lastImport >= 0) lines.splice(lastImport + 1, 0, IMPORT_LINE);
      let out = lines.join('\n');
      // حقن أوامر التفعيل داخل onCreate بعد super مباشرة
      out = out.replace(
        /(override fun onCreate\(\)\s*\{\s*\n)(\s*)(super\.onCreate\(\)\s*\n)/,
        `$1$2$3$2\n${INJECTION}\n`,
      );
      cfg.modResults.contents = out;
    }
    return cfg;
  });
}

function withSupportsRtlManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.$ = app.$ || {};
    app.$['android:supportsRtl'] = 'true';
    return cfg;
  });
}

module.exports = function withForceRtl(config) {
  config = withForceRtlMainApplication(config);
  config = withSupportsRtlManifest(config);
  return config;
};
