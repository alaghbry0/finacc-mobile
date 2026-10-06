import type { DbEngine } from './types';

/**
 * stub للويب: يمنع Metro من تحزيم engine-native.ts الحقيقي (expo-sqlite web worker
 * لا يُحزَّم عبر Metro) — على الويب المستخدم دائماً engine-web عبر getDb().
 * المنصات الأصلية تحلّل engine-native.ts العادي (بلا لاحقة platform).
 */
export async function createNativeEngine(): Promise<DbEngine> {
  throw new Error('engine-native غير متاح على الويب — المحرك الصحيح هو engine-web عبر getDb()');
}
