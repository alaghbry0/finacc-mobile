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
}
