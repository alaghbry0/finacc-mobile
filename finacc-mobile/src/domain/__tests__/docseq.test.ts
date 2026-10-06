import { createTestDb, disposeTestDb } from '@/db/test-db';
import { getDb } from '@/db/client';
import { nextDocNumber, _forceFallbackForTests, type DocType } from '@/domain/docseq';

/**
 * اختبارات الترقيم الذري (قرار 6 / ملحق د):
 * AC أساسي: 100 استدعاء متوازٍ لنفس النوع/السنة → 100 رقم فريد متسلسل بلا فجوات ولا تكرار.
 * (كل سنة اختبار معزولة عن غيرها لتجنب تداخل الحالات.)
 */

beforeAll(async () => {
  await createTestDb();
});

afterAll(() => {
  _forceFallbackForTests(false);
  disposeTestDb();
});

describe('docseq: الذرّية تحت 100 استدعاء متوازٍ', () => {
  test('نفس النوع والسنة → 100 رقم فريد متسلسل بلا فجوات (مسار RETURNING)', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => nextDocNumber('INV', { date: '2030-06-15' })),
    );
    expect(results).toHaveLength(100);

    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1)); // 1..100 بلا فجوات

    const docNos = new Set(results.map((r) => r.docNo));
    expect(docNos.size).toBe(100); // لا تكرار
    expect(docNos.has('INV-2030-00001')).toBe(true);
    expect(docNos.has('INV-2030-00100')).toBe(true);
    expect(results.every((r) => r.docNo.startsWith('INV-2030-'))).toBe(true);

    const db = await getDb();
    const rows = await db.all<{ last_no: number }>(
      "SELECT last_no FROM doc_sequence WHERE doc_type = 'INV' AND year = 2030",
    );
    expect(rows[0]?.last_no ?? -1).toBe(100);
  });

  test('المسار البديل (بلا RETURNING): نفس الضمان تحت 100 متوازٍ', async () => {
    _forceFallbackForTests(true);
    const results = await Promise.all(
      Array.from({ length: 100 }, () => nextDocNumber('PUR', { date: '2035-03-01' })),
    );
    _forceFallbackForTests(false);
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    const docNos = new Set(results.map((r) => r.docNo));
    expect(docNos.size).toBe(100);
    expect(results[0].docNo.startsWith('PUR-2035-')).toBe(true);
  });
});

describe('docseq: استقلال الأنواع والسنوات', () => {
  test('نوعان مختلفان يتسلسلان باستقلال تام', async () => {
    const inv = await Promise.all([nextDocNumber('INV', { date: '2031-01-10' }), nextDocNumber('INV', { date: '2031-02-20' }), nextDocNumber('INV', { date: '2031-03-30' })]);
    const pmt = await Promise.all([nextDocNumber('PMT', { date: '2031-01-10' }), nextDocNumber('PMT', { date: '2031-02-20' }), nextDocNumber('PMT', { date: '2031-03-30' })]);
    expect(inv.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(pmt.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(inv[0].docNo).toBe('INV-2031-00001');
    expect(pmt[0].docNo).toBe('PMT-2031-00001');
  });

  test('سنة جديدة تبدأ من 1', async () => {
    const a = await nextDocNumber('RVT', { date: '2032-01-05' });
    const b = await nextDocNumber('RVT', { date: '2032-11-05' });
    const c = await nextDocNumber('RVT', { date: '2033-01-01' });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(1);
    expect(c.docNo).toBe('RVT-2033-00001');
  });

  test('كل الأنواع الستة (الملحق د) تعمل', async () => {
    const types: DocType[] = ['INV', 'PUR', 'SRN', 'PRN', 'RVT', 'PMT'];
    const results = await Promise.all(types.map((t) => nextDocNumber(t, { date: '2036-06-15' })));
    for (const r of results) {
      expect(r.seq).toBe(1);
      expect(r.docNo).toMatch(/^[A-Z]+-2036-00001$/);
    }
  });
});

describe('docseq: بادئة INV من الشركة', () => {
  test('invoice_prefix من جدول company تُستخدم لبادئة INV', async () => {
    const db = await getDb();
    await db.run('INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES(?, ?, 1, 0, 1)', [
      'YER',
      'ريال يمني',
    ]);
    await db.run(
      "INSERT INTO company(name, currency_id, tax_rate, invoice_prefix, created_at) VALUES('متجر النور', 1, 0, 'FIN', '2034-01-01T00:00:00.000Z')",
    );
    const r = await nextDocNumber('INV', { date: '2034-05-05' });
    expect(r.docNo).toBe('FIN-2034-00001');
    // الأنواع الأخرى لا تتأثر بالبادئة
    const p = await nextDocNumber('SRN', { date: '2034-05-05' });
    expect(p.docNo).toBe('SRN-2034-00001');
  });

  test('بلا شركة أو بادئة فارغة → INV (fallback)', async () => {
    const db = await getDb();
    await db.run('UPDATE company SET invoice_prefix = NULL');
    const r = await nextDocNumber('INV', { date: '2034-06-06' });
    expect(r.docNo).toBe('INV-2034-00002'); // نفس سنة 2034 تكمل التسلسل
  });
});

describe('docseq: مدخلات غير صالحة', () => {
  test('تاريخ بصيغة خاطئة → خطأ عربي', async () => {
    let msg = '';
    try {
      await nextDocNumber('INV', { date: '15-06-2030' });
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('تاريخ غير صالح للترقيم');
  });
});
