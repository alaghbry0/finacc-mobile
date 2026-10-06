#!/usr/bin/env bash
set -euo pipefail
# حلقة البناء الإلزامية (worklog قانون 2): تصدير ويب ثابت + الإصلاحات الثلاثة + دمج المعاينة.
# قفل لمنع بناءين متوازيين (وكلاء موازون)
exec 9>/tmp/finacc-rn-build.lock
flock 9
cd "$(dirname "$0")/.."
echo "[finacc] exporting web..."
rm -rf dist
npx expo export --platform web
echo "[finacc] applying fixes..."
# 1) RTL + lang=ar على كل HTML المصدّر (إزالة lang/dir القديمة — قد تسبقها مسافات — ثم إضافة dir/lang معاً)
find dist -name '*.html' -exec sed -i -E 's#<html([[:space:]]+(lang|dir)="[^"]*")*#<html#' {} +
find dist -name '*.html' -exec sed -i 's|<html|<html lang="ar" dir="rtl"|' {} +
# 2) المسارات المطلقة → /rn/ (perl مباشرة — lookahead غير مدعوم في sed)
find dist -name '*.html' -exec perl -pi -e 's{(src|href)="/(?!/)}{$1="/rn/}g' {} +
# 2b) مسارات الأصول/chunks داخل JS كذلك — تُحمَّل وقت التشغيل من /rn/
#     (fonts, icons, async chunks مثل engine-web/migrate/sql-wasm)
find dist -name '*.js' -exec perl -pi -e 's{"/assets/}{"/rn/assets/}g; s{"/_expo/}{"/rn/_expo/}g' {} +
# 3) حقن replaceState قبل أول سكربت _expo في index.html فقط
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('dist/index.html')
if p.exists():
    s = p.read_text(encoding='utf-8')
    if 'history.replaceState' not in s:
        s = re.sub(r'(<script[^>]*src="[^"]*/_expo/[^"]*"[^>]*></script>)',
                   r'<script>try{history.replaceState(null,"","/")}catch(e){}</script>\n\1', s, count=1)
    p.write_text(s, encoding='utf-8')
    print('[finacc] replaceState injected')
PY
echo "[finacc] merging into ../public/rn ..."
rm -rf ../public/rn
mkdir -p ../public/rn
cp -r dist/* ../public/rn/
# نسخ wasm الخاص بـ sql.js (يحمله محرك الويب من /rn/assets/)
# ملاحظة: Metro يحل "browser" exports من sql.js → sql-wasm-browser.js الذي يطلب sql-wasm-browser.wasm
mkdir -p ../public/rn/assets
cp node_modules/sql.js/dist/sql-wasm.wasm ../public/rn/assets/sql-wasm.wasm
cp node_modules/sql.js/dist/sql-wasm-browser.wasm ../public/rn/assets/sql-wasm-browser.wasm
echo "[finacc] DONE → http://127.0.0.1:3000/rn/index.html"
