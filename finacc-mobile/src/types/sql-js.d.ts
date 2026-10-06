/**
 * تعريفات أنواع حزمة sql.js (الحزمة لا تُصدر أنواعها الخاصة).
 * موافق لواجهة dist/sql-wasm.js المستخدمة فعلياً.
 */
declare module 'sql.js' {
  export interface SqlJsStatement {
    bind(params?: unknown[]): void;
    step(): boolean;
    getAsObject(params?: unknown[]): Record<string, unknown>;
    free(): boolean;
  }

  export interface SqlJsDatabase {
    prepare(sql: string): SqlJsStatement;
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    run(sql: string, params?: unknown[]): void;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | null) => SqlJsDatabase;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
  }

  const initSqlJs: (config?: SqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
