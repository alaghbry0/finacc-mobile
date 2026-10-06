/**
 * أنواع بيئة اختبار bun — المتغيرات العالمية (describe/test/expect/...)
 * يحقنها مشغل `bun test` وقت التشغيل، وهنا نصرّح بها لـ tsc strict فقط.
 */
declare function describe(name: string, fn: () => void | Promise<void>): void;
declare function test(name: string, fn: () => void | Promise<void>): void;
declare function expect(value: unknown): {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeGreaterThanOrEqual(expected: number): void;
};
declare function beforeAll(fn: () => void | Promise<void>): void;
declare function afterAll(fn: () => void | Promise<void>): void;
