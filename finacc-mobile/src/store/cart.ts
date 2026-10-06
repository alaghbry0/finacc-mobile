import { Platform } from 'react-native';
import { create } from 'zustand';
import { getDb } from '@/db/client';
import { dec, money } from '@/utils/money';
import { todayISO } from '@/utils/format';
import { getSaleDefaults, getStockInWarehouse, type SaleProductRow } from '@/domain/invoicing';
import { computeInvoiceTotals, type InvoiceTotals } from '@/domain/invoice-math';

/**
 * سلة البيع (شاشة الكاشير §6.5) — zustand + استمرارية محلية (FR-02-13):
 *
 * - «مسودة السلة» تُحفظ تلقائياً عند كل تغيير (throttle ثانية واحدة) في
 *   'finacc.cart-draft' وتُستعاد عند فتح الشاشة مع علم restored → شريط
 *   «تمت استعادة فاتورتك غير المحفوظة» (AC-23).
 * - «التعليق Park» ليس مستنداً إطلاقاً (قرار 2): نسخ كاملة في
 *   'finacc.parked-carts' بلا رقم ولا صف invoice — استعادة/حذف يدويان.
 * - التخزين: الويب localStorage مباشرة (أسرع من AsyncStorage في المعاينة)،
 *   والجهاز AsyncStorage عبر استيراد ديناميكي (يبقى خارج حزمة الويب).
 * - الإجماليات كلها عبر computeInvoiceTotals — لا حساب يدوي مبعثر.
 */

const DRAFT_KEY = 'finacc.cart-draft';
const PARKED_KEY = 'finacc.parked-carts';
const PERSIST_DELAY_MS = 1000;
const MAX_PARKED = 20;

const IS_WEB = Platform.OS === 'web';

// ============ طبقة التخزين ============

async function storageGet(key: string): Promise<string | null> {
  try {
    if (IS_WEB) {
      return window.localStorage.getItem(key);
    }
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function storageSet(key: string, value: string): Promise<void> {
  try {
    if (IS_WEB) {
      window.localStorage.setItem(key, value);
      return;
    }
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(key, value);
  } catch {
    /* التخزين مبالغ صغيرة — الفشل لا يعطل البيع */
  }
}

async function storageRemove(key: string): Promise<void> {
  try {
    if (IS_WEB) {
      window.localStorage.removeItem(key);
      return;
    }
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.removeItem(key);
  } catch {
    /* تجاهل */
  }
}

// ============ الأنواع ============

export interface CartItem {
  /** معرّف السطر (غير مرتبط بقاعدة البيانات). */
  key: string;
  productId: number | null;
  name: string;
  barcode: string | null;
  qty: string;
  unitPrice: string;
  discountPercent: string;
  isService: boolean;
  lineDesc?: string;
  /** الرصيد المتاح في المستودع المختار — null للخدمي/السطر الحر. */
  available: string | null;
}

export interface CartParty {
  id: number;
  name: string;
}

/** ملخص سلة معلّقة (الشريط الكهرماني + شيت الاستعادة). */
export interface ParkedCartMeta {
  id: string;
  title: string;
  savedAt: string;
  itemCount: number;
  total: string;
}

interface ParkedCartStored extends ParkedCartMeta {
  snapshot: CartSnapshot;
}

export interface CartSnapshot {
  items: CartItem[];
  party: CartParty | null;
  cashboxId: number | null;
  cashboxName: string | null;
  warehouseId: number | null;
  warehouseName: string | null;
  currencyId: number | null;
  invoiceDiscount: string;
  notesInternal: string;
  notesPrinted: string;
  issuedAt: string;
  taxMode: 'per_item' | 'on_total';
  taxRate: string;
}

interface CartState extends CartSnapshot {
  /** انتهى التهيئة (افتراضيات القاعدة + استعادة المسودة والمعلّقات). */
  ready: boolean;
  /** استُعيدت مسودة غير محفوظة عند الفتح → شريط AC-23. */
  restored: boolean;
  parked: ParkedCartMeta[];

  init(): Promise<void>;
  /** إضافة صنف (دمج الكمية إن كان موجوداً) — يعيد حالة الإضافة. */
  addItem(product: SaleProductRow, qty?: string): Promise<'added' | 'merged'>;
  setQty(key: string, qty: string): void;
  setPrice(key: string, price: string): void;
  setDiscount(key: string, percent: string): void;
  setLineDesc(key: string, desc: string): void;
  /** حذف سطر — يعيد السطر المحذوف للتراجع. */
  removeItem(key: string): CartItem | null;
  /** تراجع: إعادة سطر حُذف للسلة. */
  undoRemove(item: CartItem): void;
  setParty(party: CartParty | null): void;
  setCashbox(id: number, name: string): void;
  /** تغيير العملة: يعيد التسعير من product_price وإلا يصفّر مع تحذير (قرار موثق). */
  setCurrency(currencyId: number): Promise<{ repriced: number; zeroed: number }>;
  setWarehouse(id: number, name: string): Promise<void>;
  setInvoiceDiscount(v: string): void;
  setNotes(internal: string, printed: string): void;
  setIssuedAt(iso: string): void;
  /** تفريغ السلة بعد الحفظ (يبقي الصندوق/العملة/المستودع الافتراضية). */
  clear(): void;
  /** إخفاء شريط الاستعادة (تجاهل). */
  dismissRestored(): void;
  /** تعليق السلة الحالية جانباً (storage محلي — ليس مستنداً). */
  park(): Promise<void>;
  restoreParked(id: string): Promise<boolean>;
  forgetParked(id: string): Promise<void>;
}

// ============ مساعدات ============

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `l${Date.now().toString(36)}-${keySeq}`;
}

function snapshotOf(s: CartState): CartSnapshot {
  return {
    items: s.items,
    party: s.party,
    cashboxId: s.cashboxId,
    cashboxName: s.cashboxName,
    warehouseId: s.warehouseId,
    warehouseName: s.warehouseName,
    currencyId: s.currencyId,
    invoiceDiscount: s.invoiceDiscount,
    notesInternal: s.notesInternal,
    notesPrinted: s.notesPrinted,
    issuedAt: s.issuedAt,
    taxMode: s.taxMode,
    taxRate: s.taxRate,
  };
}

/** إجماليات السلة لحظياً عبر computeInvoiceTotals — null عند الفراغ أو خطأ مدخلات. */
export function computeCartTotals(
  items: CartItem[],
  invoiceDiscount: string,
  taxMode: 'per_item' | 'on_total',
  taxRate: string,
): InvoiceTotals | null {
  if (items.length === 0) return null;
  try {
    return computeInvoiceTotals(
      items.map((it) => ({
        productId: it.productId,
        lineDesc: it.lineDesc,
        qty: dec(it.qty).greaterThan(0) ? it.qty : '1',
        unitPrice: it.unitPrice === '' ? '0' : it.unitPrice,
        discountPercent: it.discountPercent,
      })),
      { taxMode, taxRate, invoiceDiscount: invoiceDiscount === '' ? '0' : invoiceDiscount },
    );
  } catch {
    return null; // مدخلات ناقصة أثناء الكتابة — يظهر 0 حتى تكتمل
  }
}

async function readParked(): Promise<ParkedCartStored[]> {
  const raw = await storageGet(PARKED_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as ParkedCartStored[];
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeParked(list: ParkedCartStored[]): Promise<void> {
  await storageSet(PARKED_KEY, JSON.stringify(list.slice(0, MAX_PARKED)));
}

// ============ الحفظ المؤجل (throttle ثانية) ============

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  const s = useCartStore.getState();
  if (!s.ready) return;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const st = useCartStore.getState();
    if (!st.ready) return;
    if (st.items.length === 0) {
      void storageRemove(DRAFT_KEY);
      return;
    }
    void storageSet(DRAFT_KEY, JSON.stringify(snapshotOf(st)));
  }, PERSIST_DELAY_MS);
}

/** تفريغ مسودة السلة المحفوظة فوراً (بعد نجاح الحفظ). */
function clearPersistedDraftNow(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  void storageRemove(DRAFT_KEY);
}

// ============ المتجر ============

const EMPTY_NOTES = '';

export const useCartStore = create<CartState>((set, get) => ({
  ready: false,
  restored: false,
  items: [],
  party: null,
  cashboxId: null,
  cashboxName: null,
  warehouseId: null,
  warehouseName: null,
  currencyId: null,
  invoiceDiscount: '0',
  notesInternal: EMPTY_NOTES,
  notesPrinted: EMPTY_NOTES,
  issuedAt: todayISO(),
  taxMode: 'on_total',
  taxRate: '0',
  parked: [],

  init: async () => {
    if (get().ready) return;
    const defaults = await getSaleDefaults();
    let next: Partial<CartSnapshot> = {
      cashboxId: defaults.cashboxId,
      cashboxName: defaults.cashboxName,
      warehouseId: defaults.warehouseId,
      warehouseName: defaults.warehouseName,
      currencyId: defaults.baseCurrencyId,
      taxMode: defaults.taxMode,
      taxRate: defaults.taxRate,
      issuedAt: todayISO(),
    };
    let restored = false;
    const raw = await storageGet(DRAFT_KEY);
    if (raw !== null) {
      try {
        const snap = JSON.parse(raw) as CartSnapshot;
        if (snap && Array.isArray(snap.items) && snap.items.length > 0) {
          next = { ...next, ...snap };
          restored = true;
        }
      } catch {
        /* مسودة تالفة → الافتراضيات */
      }
    }
    const parked = await readParked();
    set({
      ...next,
      items: next.items ?? [],
      ready: true,
      restored,
      parked: parked.map(({ id, title, savedAt, itemCount, total }) => ({ id, title, savedAt, itemCount, total })),
    });
  },

  addItem: async (product, qty = '1') => {
    const st = get();
    const existing = st.items.find((it) => it.productId === product.id);
    if (existing !== undefined) {
      set({
        items: st.items.map((it) =>
          it.key === existing.key ? { ...it, qty: money(dec(it.qty).plus(dec(qty))) } : it,
        ),
      });
      schedulePersist();
      return 'merged';
    }
    let available: string | null = null;
    if (!product.isService && st.warehouseId !== null) {
      available = await getStockInWarehouse(product.id, st.warehouseId);
    } else if (!product.isService) {
      available = product.totalQty; // بلا مستودع مختار بعد — الرصيد الكلي
    }
    const item: CartItem = {
      key: newKey(),
      productId: product.id,
      name: product.name,
      barcode: product.barcode,
      qty: qty,
      unitPrice: product.price ?? '0',
      discountPercent: '0',
      isService: product.isService,
      available,
    };
    set({ items: [...st.items, item] });
    schedulePersist();
    return 'added';
  },

  setQty: (key, qty) => {
    const q = dec(qty);
    if (!q.greaterThan(0)) return; // الصفر يعالجه الاستدعاء (حذف بتراجع)
    set({ items: get().items.map((it) => (it.key === key ? { ...it, qty: money(q) } : it)) });
    schedulePersist();
  },

  setPrice: (key, price) => {
    const p = dec(price);
    if (p.isNegative()) return;
    set({ items: get().items.map((it) => (it.key === key ? { ...it, unitPrice: money(p) } : it)) });
    schedulePersist();
  },

  setDiscount: (key, percent) => {
    const p = dec(percent);
    if (p.isNegative() || p.greaterThan(100)) return;
    set({ items: get().items.map((it) => (it.key === key ? { ...it, discountPercent: money(p) } : it)) });
    schedulePersist();
  },

  setLineDesc: (key, desc) => {
    set({ items: get().items.map((it) => (it.key === key ? { ...it, lineDesc: desc } : it)) });
    schedulePersist();
  },

  removeItem: (key) => {
    const item = get().items.find((it) => it.key === key) ?? null;
    set({ items: get().items.filter((it) => it.key !== key) });
    schedulePersist();
    return item;
  },

  undoRemove: (item) => {
    if (get().items.some((it) => it.key === item.key)) return;
    set({ items: [...get().items, item] });
    schedulePersist();
  },

  setParty: (party) => {
    set({ party });
    schedulePersist();
  },

  setCashbox: (id, name) => {
    set({ cashboxId: id, cashboxName: name });
    schedulePersist();
  },

  setCurrency: async (currencyId) => {
    const st = get();
    if (st.currencyId === currencyId) return { repriced: 0, zeroed: 0 };
    let repriced = 0;
    let zeroed = 0;
    const db = await getDb();
    const items = await Promise.all(
      st.items.map(async (it): Promise<CartItem> => {
        if (it.productId === null) return it;
        const rows = await db.all<{ price: string | number }>(
          "SELECT price FROM product_price WHERE product_id = ? AND currency_id = ? AND price_level = 'retail'",
          [it.productId, currencyId],
        );
        if (rows.length > 0) {
          repriced += 1;
          return { ...it, unitPrice: money(rows[0].price) };
        }
        zeroed += 1;
        return { ...it, unitPrice: '0' };
      }),
    );
    set({ currencyId, items });
    schedulePersist();
    return { repriced, zeroed };
  },

  setWarehouse: async (id, name) => {
    set({ warehouseId: id, warehouseName: name });
    // تحديث «المتاح» لكل بنود المخزون بالمستودع الجديد
    const items = await Promise.all(
      get().items.map(async (it): Promise<CartItem> => {
        if (it.productId === null || it.isService) return it;
        return { ...it, available: await getStockInWarehouse(it.productId, id) };
      }),
    );
    set({ items });
    schedulePersist();
  },

  setInvoiceDiscount: (v) => {
    const d = dec(v);
    if (d.isNegative()) return;
    set({ invoiceDiscount: money(d) });
    schedulePersist();
  },

  setNotes: (internal, printed) => {
    set({ notesInternal: internal, notesPrinted: printed });
    schedulePersist();
  },

  setIssuedAt: (iso) => {
    set({ issuedAt: iso });
    schedulePersist();
  },

  clear: () => {
    clearPersistedDraftNow();
    set({
      items: [],
      party: null,
      invoiceDiscount: '0',
      notesInternal: EMPTY_NOTES,
      notesPrinted: EMPTY_NOTES,
      issuedAt: todayISO(),
      restored: false,
    });
  },

  dismissRestored: () => {
    set({ restored: false });
  },

  park: async () => {
    const st = get();
    if (st.items.length === 0) return;
    const totals = computeCartTotals(st.items, st.invoiceDiscount, st.taxMode, st.taxRate);
    const stored: ParkedCartStored = {
      id: `p${Date.now().toString(36)}`,
      title: st.party?.name ?? `سلة ${st.parked.length + 1}`,
      savedAt: new Date().toISOString(),
      itemCount: st.items.length,
      total: totals?.total ?? '0',
      snapshot: snapshotOf(st),
    };
    const list = [stored, ...(await readParked())].slice(0, MAX_PARKED);
    await writeParked(list);
    set({
      parked: list.map(({ id, title, savedAt, itemCount, total }) => ({ id, title, savedAt, itemCount, total })),
    });
    get().clear(); // تفريغ السلة الجارية (المسودة المحفوظة تُزال أيضاً)
  },

  restoreParked: async (id) => {
    const list = await readParked();
    const found = list.find((p) => p.id === id);
    if (found === undefined) return false;
    const rest = list.filter((p) => p.id !== id);
    await writeParked(rest);
    set({
      ...found.snapshot,
      restored: false, // استعادة صريحة — لا شريط AC-23
      parked: rest.map(({ id: pid, title, savedAt, itemCount, total }) => ({
        id: pid,
        title,
        savedAt,
        itemCount,
        total,
      })),
    });
    // كتابة المسودة فوراً حتى لا تضيع الاستعادة بانهيار مبكر
    await storageSet(DRAFT_KEY, JSON.stringify(snapshotOf(get())));
    return true;
  },

  forgetParked: async (id) => {
    const rest = (await readParked()).filter((p) => p.id !== id);
    await writeParked(rest);
    set({
      parked: rest.map(({ id: pid, title, savedAt, itemCount, total }) => ({
        id: pid,
        title,
        savedAt,
        itemCount,
        total,
      })),
    });
  },
}));
