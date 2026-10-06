import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { setCurrentUserId } from '@/domain/session-user';
import { hashPin } from '@/services/crypto';
import { isValidEan13 } from '@/utils/barcode';
import {
  adjustStock,
  archiveCategory,
  archiveProduct,
  archiveUnit,
  createProduct,
  findByBarcode,
  getProductFull,
  listBelowMinStock,
  listCategories,
  listUnits,
  productMovements,
  searchProducts,
  updateProduct,
  upsertCategory,
  upsertUnit,
  type ProductInput,
} from '@/domain/inventory';

/**
 * اختبارات وحدة الأصناف والمخزون (الوحدة 01):
 * الزرع عبر completeOnboarding (عملة أساس YER + مستخدم + «المخزن الرئيسي» + إعدادات)
 * ثم كل عقود الدومين: الإنشاء/الباركود/الافتتاحي/التعديل/الأرشفة/البحث/الرصيد/الفئات/الوحدات.
 */

beforeAll(async () => {
  await createTestDb();
  await completeOnboarding({
    companyName: 'متجر الاختبار',
    baseCurrencyCode: 'YER',
    pinHash: await hashPin('1234'),
  });
});

afterAll(() => {
  setCurrentUserId(null);
  disposeTestDb();
});

async function errOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : '';
  }
}

function baseInput(over: Partial<ProductInput> = {}): ProductInput {
  return {
    name: 'حليب المراعي 1ل',
    prices: [{ currencyId: 1, price: '1000' }], // YER = العملة الأساس (id 1)
    ...over,
  };
}

describe('createProduct: الباركود (FR-01-01/02)', () => {
  test('باركود فارغ → يولَّد EAN-13 داخلياً يبدأ بـ 2 وصحيح', async () => {
    const id = await createProduct(baseInput({ name: 'صنف بلا باركود', barcode: '' }));
    const db = await getDb();
    const rows = await db.all<{ barcode: string | null }>('SELECT barcode FROM product WHERE id = ?', [id]);
    expect(rows[0]?.barcode).not.toBeNull();
    const code = rows[0]!.barcode!;
    expect(code.length).toBe(13);
    expect(code.startsWith('2')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
  });

  test('باركود مكرر (لصنف فاعل) → خطأ عربي واضح', async () => {
    await createProduct(baseInput({ name: 'الأول', barcode: '1111111111116' }));
    const msg = await errOf(() => createProduct(baseInput({ name: 'الثاني', barcode: '1111111111116' })));
    expect(msg).toContain('مستخدم بالفعل');
    expect(msg).toContain('1111111111116');
  });

  test('باركود مكرر لصنف مؤرشف → يبقى محجوزاً (FR-01-15)', async () => {
    const id = await createProduct(baseInput({ name: 'المحجوز', barcode: '2222222222221' }));
    await archiveProduct(id);
    const msg = await errOf(() => createProduct(baseInput({ name: 'المنافس', barcode: '2222222222221' })));
    expect(msg).toContain('محجوزاً');
  });

  test('اسم فارغ → رفض zod قبل أي كتابة', async () => {
    const msg = await errOf(() => createProduct(baseInput({ name: '   ' })));
    expect(msg).toContain('اسم الصنف مطلوب');
  });
});

describe('createProduct: الخدمي والافتتاحي (FR-01-01/16)', () => {
  test('خدمي مع كمية افتتاحية → خطأ', async () => {
    const msg = await errOf(() =>
      createProduct(baseInput({ name: 'خدمة توصيل', isService: true, openingQty: '5' })),
    );
    expect(msg).toContain('خدمي');
  });

  test('كمية افتتاحية → stock_level صحيح + حركة opening بالتكلفة', async () => {
    const db = await getDb();
    const id = await createProduct(
      baseInput({ name: 'أرز بسمتي 5ك', barcode: '3333333333338', costPrice: '900', openingQty: '12.5' }),
    );
    const level = await db.all<{ qty: string | number }>(
      'SELECT qty FROM stock_level WHERE product_id = ?',
      [id],
    );
    expect(level).toHaveLength(1);
    expect(String(level[0]!.qty)).toBe('12.5');

    const moves = await productMovements(id);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.movementType).toBe('opening');
    expect(moves[0]!.qty).toBe('12.5');
    expect(moves[0]!.unitCost).toBe('900'); // تكلفة الصنف
    expect(moves[0]!.notes).toContain('افتتاحي');
  });

  test('خدمي بلا أي صف رصيد أو حركة', async () => {
    const db = await getDb();
    const id = await createProduct(baseInput({ name: 'تركيب ستائر', isService: true }));
    const level = await db.all('SELECT id FROM stock_level WHERE product_id = ?', [id]);
    const moves = await db.all('SELECT id FROM stock_movement WHERE product_id = ?', [id]);
    expect(level).toHaveLength(0);
    expect(moves).toHaveLength(0);
  });

  test('أسعار البيع تُخزَّن بمستوى retail لكل عملة', async () => {
    const db = await getDb();
    const id = await createProduct(
      baseInput({ name: 'صنف متعدد الأسعار', prices: [{ currencyId: 1, price: '1000' }, { currencyId: 2, price: '15' }] }),
    );
    const prices = await db.all<{ price_level: string; currency_id: number; price: string }>(
      'SELECT price_level, currency_id, price FROM product_price WHERE product_id = ? ORDER BY currency_id',
      [id],
    );
    expect(prices.map((p) => p.price_level)).toEqual(['retail', 'retail']);
    expect(prices.map((p) => String(p.price))).toEqual(['1000', '15']);
  });
});

describe('adjustStock: التعديل اليدوي (FR-01-07 / قرار 9)', () => {
  test('تخفيض الكمية → حركة سالبة + رصيد متجدد + قيد تدقيق', async () => {
    const db = await getDb();
    const id = await createProduct(
      baseInput({ name: 'سكر 1ك', barcode: '4444444444448', costPrice: '700', openingQty: '20' }),
    );
    await adjustStock({ productId: id, warehouseId: 1, newQty: '8', reason: 'جرد سريع' });

    const level = await db.all<{ qty: string | number }>('SELECT qty FROM stock_level WHERE product_id = ?', [id]);
    expect(String(level[0]!.qty)).toBe('8');

    const moves = await productMovements(id);
    expect(moves).toHaveLength(2);
    const manual = moves.find((m) => m.movementType === 'manual_adjust');
    expect(manual).toBeDefined();
    expect(manual!.qty).toBe('-12'); // signed
    expect(manual!.unitCost).toBe('700');
    expect(manual!.notes).toBe('جرد سريع');

    const audit = await db.all<{ c: number }>(
      "SELECT count(*) AS c FROM audit_log WHERE action = 'stock_adjust' AND entity_id = ?",
      [id],
    );
    expect(audit[0]!.c).toBe(1);
  });

  test('كمية تجعل الرصيد سالباً → رفض برسالة تسمّي الصنف والكمية الناقصة (قاعدة 5.4-5)', async () => {
    const id = await createProduct(baseInput({ name: 'شاي أحمر', barcode: '5555555555555', openingQty: '3' }));
    const msg = await errOf(() => adjustStock({ productId: id, warehouseId: 1, newQty: '-2' }));
    expect(msg).toContain('شاي أحمر');
    expect(msg).toContain('2'); // الكمية الناقصة
    expect(msg).toContain('سالباً');
    // لا شيء كُتب
    const level = await getDb().then((db) => db.all<{ qty: string | number }>('SELECT qty FROM stock_level WHERE product_id = ?', [id]));
    expect(String((await level)[0]!.qty)).toBe('3');
  });

  test('صنف خدمي → رفض تعديل رصيده', async () => {
    const id = await createProduct(baseInput({ name: 'خدمة صيانة', isService: true }));
    const msg = await errOf(() => adjustStock({ productId: id, warehouseId: 1, newQty: '5' }));
    expect(msg).toContain('خدمي');
  });

  test('تعديل بنفس الكمية → لا حركة جديدة (CHECK qty <> 0 محترم)', async () => {
    const id = await createProduct(baseInput({ name: 'ملح 1ك', barcode: '6666666666662', openingQty: '10' }));
    await adjustStock({ productId: id, warehouseId: 1, newQty: '10' });
    const moves = await productMovements(id);
    expect(moves).toHaveLength(1); // الافتتاحية فقط
  });
});

describe('searchProducts / findByBarcode (FR-01-03/04)', () => {
  test('بحث جزئي بالاسم وبادئة الباركود + استبعاد المؤرشف', async () => {
    await createProduct(baseInput({ name: 'جبنة بوك كريم', barcode: '7777777777773', costPrice: '100' }));
    const byName = await searchProducts('بوك');
    expect(byName.some((p) => p.name === 'جبنة بوك كريم')).toBe(true);

    const byBarcode = await searchProducts('77777777777');
    expect(byBarcode.some((p) => p.name === 'جبنة بوك كريم')).toBe(true);

    // مؤرشف لا يظهر
    const archId = await createProduct(baseInput({ name: 'جبنة مؤرشفة للبحث', barcode: '8888888888880' }));
    await archiveProduct(archId);
    const afterArchive = await searchProducts('جبنة مؤرشفة');
    expect(afterArchive).toHaveLength(0);
    // إلا بطلب صريح
    const withArchived = await searchProducts('جبنة مؤرشفة', { includeArchived: true });
    expect(withArchived).toHaveLength(1);
    expect(withArchived[0]!.isArchived).toBe(true);
  });

  test('محارف LIKE الخاصة (%) لا تكسر البحث', async () => {
    const results = await searchProducts('%%%');
    expect(Array.isArray(results)).toBe(true);
  });

  test('السعر الظاهر هو retail بالعملة الأساس + belowMin محسوب', async () => {
    const id = await createProduct(
      baseInput({ name: 'ماء غازي', barcode: '9999999999996', costPrice: '300', minStock: '10', openingQty: '4', prices: [{ currencyId: 1, price: '400' }] }),
    );
    const rows = await searchProducts('ماء غازي');
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row!.basePrice).toBe('400');
    expect(row!.totalQty).toBe('4');
    expect(row!.costPrice).toBe('300');
    expect(row!.belowMin).toBe(true); // 4 < 10
  });

  test('findByBarcode: مطابقة تامة — المؤرشف لا يظهر (FR-01-03)', async () => {
    const found = await findByBarcode('7777777777773');
    expect(found?.name).toBe('جبنة بوك كريم');
    expect(await findByBarcode('8888888888880')).toBeNull(); // مؤرشف
    expect(await findByBarcode('0000000000000')).toBeNull(); // غير موجود
  });
});

describe('listBelowMinStock (FR-01-12)', () => {
  test('يجد من تحت حده الأدنى ويستبعد الخدمي والمؤرشف', async () => {
    const list = await listBelowMinStock();
    const names = list.map((p) => p.name);
    expect(names).toContain('ماء غازي'); // 4 < 10
    expect(names.every((n) => n !== 'خدمة توصيل')).toBe(true); // خدمي
    expect(names.every((n) => n !== 'جبنة مؤرشفة للبحث')).toBe(true); // مؤرشف
    for (const row of list) {
      expect(row.belowMin).toBe(true);
    }
  });
});

describe('updateProduct', () => {
  test('تحديث الحقول والأسعار (استبدال مباشر) + بقاء الافتتاحي كما هو', async () => {
    const db = await getDb();
    const id = await createProduct(
      baseInput({ name: 'عصير مانجو', barcode: '1212121212128', costPrice: '500', minStock: '5', openingQty: '15' }),
    );
    await updateProduct(id, {
      name: 'عصير مانجو 500مل',
      barcode: '1212121212128',
      costPrice: '550',
      minStock: '2',
      prices: [{ currencyId: 1, price: '750' }],
    });

    const full = await getProductFull(id);
    expect(full!.name).toBe('عصير مانجو 500مل');
    expect(full!.costPrice).toBe('550');
    expect(full!.minStock).toBe('2');
    expect(full!.prices).toHaveLength(1);
    expect(full!.prices[0]!.price).toBe('750');
    // الافتتاحي لم يتغير ولم يتكرر
    expect(full!.totalQty).toBe('15');
    expect(full!.movements.filter((m) => m.movementType === 'opening')).toHaveLength(1);

    const audit = await db.all<{ c: number }>(
      "SELECT count(*) AS c FROM audit_log WHERE action = 'product_update' AND entity_id = ?",
      [id],
    );
    expect(audit[0]!.c).toBe(1);
  });

  test('mergePrices=true يبقي أسعار العملات غير الممررة', async () => {
    const id = await createProduct(
      baseInput({ name: 'منتج دمج أسعار', barcode: '1313131313135', prices: [{ currencyId: 1, price: '100' }, { currencyId: 2, price: '2' }] }),
    );
    await updateProduct(id, {
      name: 'منتج دمج أسعار',
      prices: [{ currencyId: 1, price: '120' }],
      mergePrices: true,
    });
    const full = await getProductFull(id);
    expect(full!.prices).toHaveLength(2);
    expect(full!.prices.find((p) => p.currencyId === 1)!.price).toBe('120');
    expect(full!.prices.find((p) => p.currencyId === 2)!.price).toBe('2');
  });

  test('تحويل فاعل ذي رصيد إلى خدمي → رفض', async () => {
    const id = await createProduct(baseInput({ name: 'معدل للخدمية', barcode: '1414141414142', openingQty: '3' }));
    const msg = await errOf(() => updateProduct(id, { name: 'معدل للخدمية', isService: true, prices: [] }));
    expect(msg).toContain('رصيد');
  });

  test('باركود صنف آخر عند التعديل → رفض (حجز فريد)', async () => {
    const a = await createProduct(baseInput({ name: 'حامل أ', barcode: '1515151515159' }));
    const b = await createProduct(baseInput({ name: 'حامل ب', barcode: '1616161616166' }));
    const msg = await errOf(() =>
      updateProduct(b, { name: 'حامل ب', barcode: '1515151515159', prices: [] }),
    );
    expect(msg).toContain('مستخدم بالفعل');
    expect(msg).toContain(String(a) === '' ? '' : '1515151515159');
  });
});

describe('getProductFull (بطاقة الصنف §6.5)', () => {
  test('يجمع الأسعار والأرصدة والحركات', async () => {
    const id = await createProduct(
      baseInput({ name: 'بطاقة كاملة', barcode: '1717171717173', costPrice: '250', minStock: '3', openingQty: '7', prices: [{ currencyId: 1, price: '300' }] }),
    );
    await adjustStock({ productId: id, warehouseId: 1, newQty: '5', reason: 'كسر' });

    const full = await getProductFull(id);
    expect(full).not.toBeNull();
    expect(full!.stocks).toHaveLength(1);
    expect(full!.stocks[0]!.warehouseName).toBe('المخزن الرئيسي');
    expect(full!.stocks[0]!.qty).toBe('5');
    expect(full!.movements).toHaveLength(2);
    expect(full!.movements[0]!.movementType).toBe('manual_adjust');
    expect(full!.movements[0]!.qty).toBe('-2');
    expect(await getProductFull(999999)).toBeNull();
  });
});

describe('الفئات (FR-01-05)', () => {
  test('شجرة بعمق مستويين + الأرشفة تُمنع مع أصناف فاعلة', async () => {
    const parent = await upsertCategory(null, 'ألبان');
    const child = await upsertCategory(null, 'أجبان', parent);
    const tree = await listCategories();
    const node = tree.find((c) => c.id === parent);
    expect(node).toBeDefined();
    expect(node!.children.map((c) => c.name)).toContain('أجبان');

    // عمق ثالث → رفض
    const msg3 = await errOf(() => upsertCategory(null, 'عمق ثالث', child));
    expect(msg3).toContain('مستويين');

    // فئة عليها صنف فاعل → لا تُؤرشف
    await createProduct(baseInput({ name: 'جبن مثلثات', categoryId: child }));
    const msgArchive = await errOf(() => archiveCategory(child));
    expect(msgArchive).toContain('صنفاً فاعلاً');

    // فئة فارغة → تُؤرشف
    const empty = await upsertCategory(null, 'فئة فارغة');
    await archiveCategory(empty);
    expect((await listCategories()).some((c) => c.id === empty)).toBe(false);
  });
});

describe('الوحدات (FR-01-05)', () => {
  test('وحدة بمعامل تحويل + سلسلة مستويين فقط', async () => {
    const piece = await upsertUnit(null, 'قطعة');
    const box = await upsertUnit(null, 'كرتون', piece, '24');
    const units = await listUnits();
    const boxRow = units.find((u) => u.id === box);
    expect(boxRow?.factor).toBe('24');
    expect(boxRow?.baseUnitId).toBe(piece);

    // كرتون أساس لكرتون ثالث → رفض (سلسلة مستويين)
    const msg3 = await errOf(() => upsertUnit(null, 'بالة', box, '10'));
    expect(msg3).toContain('مستويان');
    // الوحدة أساس لنفسها → رفض
    const msgSelf = await errOf(() => upsertUnit(piece, 'قطعة', piece, '1'));
    expect(msgSelf).toContain('نفسها');
    // معامل صفر → رفض
    const msgFactor = await errOf(() => upsertUnit(null, 'حصة', undefined, '0'));
    expect(msgFactor).toContain('أكبر من صفر');
  });

  test('أرشفة وحدة عليها أصناف فاعلة → رفض، ووحدة حرة → تُؤرشف', async () => {
    const piece = await upsertUnit(null, 'غرام');
    const blocker = await createProduct(baseInput({ name: 'زعفران 1غ', barcode: '1919191919197', unitId: piece }));
    const msgBlock = await errOf(() => archiveUnit(piece));
    expect(msgBlock).toContain('صنفاً فاعلاً');
    void blocker;

    const free = await upsertUnit(null, 'لتر');
    await archiveUnit(free);
    expect((await listUnits()).some((u) => u.id === free)).toBe(false);
  });
});

describe('الأرشفة والتحويل بين القوائم (FR-01-15)', () => {
  test('أرشفة → يختفي من البحث ويتاح بالتقارير (is_archived=1)', async () => {
    const db = await getDb();
    const id = await createProduct(baseInput({ name: 'صنف للأرشفة', barcode: '1818181818180', openingQty: '2' }));
    await archiveProduct(id);
    const rows = await db.all<{ is_archived: number }>('SELECT is_archived FROM product WHERE id = ?', [id]);
    expect(rows[0]!.is_archived).toBe(1);
    expect((await searchProducts('صنف للأرشفة')).length).toBe(0);
    // الحركات التاريخية باقية (لا حذف أبداً)
    expect((await productMovements(id)).length).toBeGreaterThan(0);
    // الأرشفة مرة أخرى → لا خطأ (idempotent)
    await archiveProduct(id);
  });
});
