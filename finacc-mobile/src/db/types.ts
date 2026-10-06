/**
 * الواجهة الموحدة لمحرك قاعدة البيانات — كل المنصات (web/sql.js وnative/expo-sqlite).
 * القرار المعماري: المعاملات تُدار عبر engine.transaction() فقط، لا عبر drizzle.
 */
export interface DbEngine {
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  persist(): void;

  /**
   * تصدير بايتات القاعدة كاملة (النسخ الاحتياطي — الوحدة 11).
   * اختياري: يوفره محرك الويب (db.export) ومحرك الجهاز (قراءة الملف بعد checkpoint).
   */
  exportDbBytes?(): Promise<Uint8Array>;

  /**
   * استبدال القاعدة المحفوظة ببايتات أخرى (الاستعادة — FR-11-02) ويمنع أي كتابة
   * لاحقة من النسخة القديمة في الذاكرة (استدعِ إعادة التحميل بعده مباشرة).
   * يوفره محرك الويب.
   */
  importDbBytes?(bytes: Uint8Array): Promise<void>;

  /** إغلاق الاتصال (قبل استبدال ملف القاعدة على الجهاز). يوفره المحرك الأصلي. */
  close?(): Promise<void>;
}
