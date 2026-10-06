/**
 * أنواع بيئة اختبار bun — المتغيرات العالمية (describe/test/expect/...)
 * يحقنها مشغل `bun test` وقت التشغيل، وهنا نصرّح بها لـ tsc strict فقط.
 * (ملف بيئي مشترك لكل ملفات الاختبار في المشروع — أُثري بمطابقات إضافية في Task 2-a.)
 */
type ErrorCtor = new (...args: never[]) => Error;

interface AsyncExpectMatchers {
  toBe(expected: unknown): Promise<void>;
  toEqual(expected: unknown): Promise<void>;
  toBeTruthy(): Promise<void>;
  toBeFalsy(): Promise<void>;
  toBeNull(): Promise<void>;
  toBeDefined(): Promise<void>;
  toBeGreaterThan(expected: number): Promise<void>;
  toBeLessThan(expected: number): Promise<void>;
  toContain(expected: unknown): Promise<void>;
  toThrow(expected?: string | RegExp | ErrorCtor): Promise<void>;
}

interface ExpectMatchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeInstanceOf(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toContain(expected: unknown): void;
  toContainEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeCloseTo(expected: number, precision?: number): void;
  toMatch(expected: RegExp | string): void;
  toMatchObject(expected: Record<string, unknown>): void;
  toThrow(expected?: string | RegExp | ErrorCtor): void;
  readonly not: ExpectMatchers;
  readonly rejects: AsyncExpectMatchers;
  readonly resolves: AsyncExpectMatchers;
}

declare function expect(value: unknown): ExpectMatchers;
declare namespace expect {
  function arrayContaining(expected: readonly unknown[]): unknown[];
  function objectContaining(expected: Record<string, unknown>): Record<string, unknown>;
  function anything(): unknown;
  function any(expected: unknown): unknown;
}

declare function describe(name: string, fn: () => void | Promise<void>): void;
declare function test(name: string, fn: () => void | Promise<void>): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function beforeAll(fn: () => void | Promise<void>): void;
declare function afterAll(fn: () => void | Promise<void>): void;
declare function beforeEach(fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void | Promise<void>): void;
