import {
  SYSTEM_ACCOUNTS,
  ALL_CASH_TX_TYPES,
  ALL_MOVEMENT_TYPES,
  POSTING_MAP,
  getPosting,
  cashTxPostingKey,
  movementPostingKey,
  type PostingRule,
} from '@/domain/posting-map';

/**
 * اختبارات خريطة الترحيل (قرار 7 / ملحق و):
 * كل tx_type/movement_type معرف في schema له قاعدة، وكل حساب من التسعة،
 * والمسحوبات بند مستقل خارج المصاريف حرفياً.
 */

const PL_LINES = [
  'sales',
  'sales_return',
  'cogs',
  'cogs_return',
  'stock_gain',
  'stock_loss',
  'expenses',
  'owner_draw',
  'capital',
  'fx_gain_loss',
] as const;

describe('posting-map: التغطية الكاملة (قاعدة 5.4-8)', () => {
  test('كل tx_type في cash_tx (كما في CHECK الجدول) له قاعدة', () => {
    for (const t of ALL_CASH_TX_TYPES) {
      expect(() => getPosting(cashTxPostingKey(t))).not.toThrow();
    }
    expect(ALL_CASH_TX_TYPES).toHaveLength(12);
  });

  test('كل movement_type في stock_movement (كما في CHECK الجدول) له قاعدة', () => {
    for (const m of ALL_MOVEMENT_TYPES) {
      expect(() => getPosting(movementPostingKey(m))).not.toThrow();
    }
    expect(ALL_MOVEMENT_TYPES).toHaveLength(9);
  });

  test('الحسابات النظامية تسعة حرفياً', () => {
    expect(SYSTEM_ACCOUNTS).toHaveLength(9);
    expect([...SYSTEM_ACCOUNTS]).toEqual(
      expect.arrayContaining(['CASH', 'AR', 'AP', 'INV', 'COGS', 'EXP', 'EQ', 'FX', 'CHQ']),
    );
  });

  test('كل حساب في كل قاعدة ينتمي إلى SYSTEM_ACCOUNTS', () => {
    const allowed = SYSTEM_ACCOUNTS as readonly string[];
    for (const [key, rule] of Object.entries(POSTING_MAP)) {
      for (const acc of [...rule.debit, ...rule.credit]) {
        expect(`${key}:${acc} من الحسابات النظامية`).toBeTruthy();
        expect(allowed.includes(acc)).toBe(true);
      }
    }
  });

  test('كل بند أرباح (PlLine) مستخدم في قاعدة واحدة على الأقل — لا بند ميت', () => {
    const used = new Set<string>();
    for (const rule of Object.values(POSTING_MAP)) {
      if (rule.plLine) used.add(rule.plLine);
    }
    for (const line of PL_LINES) {
      expect(used.has(line)).toBe(true);
    }
    expect(used.size).toBe(PL_LINES.length);
  });

  test('مفتاح مجهول → خطأ عربي يوقف التنفيذ', () => {
    let msg = '';
    try {
      getPosting('not_a_real_key');
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toContain('مفتاح ترحيل مجهول');
  });
});

describe('posting-map: قواعد الملحق و الحرفية', () => {
  test('مسحوبات المالك: CASH → EQ وبند owner_draw مستقل — ليست مصروفاً (قرار 7 حرفياً)', () => {
    const rule: PostingRule = getPosting('owner_draw');
    expect(rule.debit).toEqual(['EQ']);
    expect(rule.credit).toEqual(['CASH']);
    expect(rule.plLine).toBe('owner_draw');
    expect(rule.plLine).not.toBe('expenses');
  });

  test('إيداع المالك (رأس المال): CASH → EQ بند capital', () => {
    const rule = getPosting('capital_in');
    expect(rule.debit).toEqual(['CASH']);
    expect(rule.credit).toEqual(['EQ']);
    expect(rule.plLine).toBe('capital');
  });

  test('مصروف: CASH → EXP بند expenses', () => {
    const rule = getPosting('expense');
    expect(rule.debit).toEqual(['EXP']);
    expect(rule.credit).toEqual(['CASH']);
    expect(rule.plLine).toBe('expenses');
  });

  test('قبض تحصيل من عميل: AR → CASH (تسوية دين بلا أثر ربحي)', () => {
    const rule = getPosting('receipt');
    expect(rule.debit).toEqual(['AR']);
    expect(rule.credit).toEqual(['CASH']);
    expect(rule.plLine).toBeNull();
  });

  test('صرف دفع لمورد: AP → CASH', () => {
    const rule = getPosting('payment');
    expect(rule.debit).toEqual(['AP']);
    expect(rule.credit).toEqual(['CASH']);
    expect(rule.plLine).toBeNull();
  });

  test('تحويل بين صندوقين بعملتين: CASH → CASH + FX و بند فروق صرف', () => {
    const rule = getPosting('box_transfer');
    expect(rule.debit).toEqual(['CASH']);
    expect(rule.credit).toEqual(['CASH', 'FX']);
    expect(rule.plLine).toBe('fx_gain_loss');
  });

  test('حركة بيع مخزون: INV → COGS بند cogs', () => {
    const rule = getPosting('sale');
    expect(rule.debit).toEqual(['COGS']);
    expect(rule.credit).toEqual(['INV']);
    expect(rule.plLine).toBe('cogs');
  });

  test('مرتجع بيع: INV ← COGS بند cogs_return (تكلفة line_cost)', () => {
    const rule = getPosting('sale_return');
    expect(rule.debit).toEqual(['INV']);
    expect(rule.credit).toEqual(['COGS']);
    expect(rule.plLine).toBe('cogs_return');
  });

  test('بيع مكتمل: يقاس من الفواتير مباشرة — بند sales بلا حسابات', () => {
    const rule = getPosting('sale_completed');
    expect(rule.debit).toEqual([]);
    expect(rule.credit).toEqual([]);
    expect(rule.plLine).toBe('sales');
  });

  test('مرتجع المبيعات بند مستقل sales_return يقاس من فواتير المرتجع', () => {
    const rule = getPosting('sale_return_completed');
    expect(rule.plLine).toBe('sales_return');
  });

  test('شراء: INV مديناً والدائن CASH (نقدي) أو AP (آجل)', () => {
    const rule = getPosting('purchase');
    expect(rule.debit).toEqual(['INV']);
    expect(rule.credit).toEqual(['CASH', 'AP']);
    expect(rule.plLine).toBeNull();
  });

  test('مرتجع شراء: INV → CASH/AP', () => {
    const rule = getPosting('purchase_return');
    expect(rule.debit).toEqual(['CASH', 'AP']);
    expect(rule.credit).toEqual(['INV']);
    expect(rule.plLine).toBeNull();
  });

  test('جرد: زيادة → stock_gain / عجز → stock_loss (قرار 7)', () => {
    expect(getPosting('stocktake_adjust_gain').plLine).toBe('stock_gain');
    expect(getPosting('stocktake_adjust_gain').debit).toEqual(['INV']);
    expect(getPosting('stocktake_adjust_loss').plLine).toBe('stock_loss');
    expect(getPosting('stocktake_adjust_loss').credit).toEqual(['INV']);
    expect(getPosting('manual_adjust_gain').plLine).toBe('stock_gain');
    expect(getPosting('manual_adjust_loss').plLine).toBe('stock_loss');
  });

  test('الافتتاحيات: صندوق CASH/EQ ومخزون INV/EQ (مفاتيح مفكوكة التعارض)', () => {
    expect(getPosting('cash_opening')).toEqual({ debit: ['CASH'], credit: ['EQ'], plLine: null });
    expect(getPosting('stock_opening')).toEqual({ debit: ['INV'], credit: ['EQ'], plLine: null });
    expect(cashTxPostingKey('opening')).toBe('cash_opening');
    expect(movementPostingKey('opening')).toBe('stock_opening');
  });
});

describe('posting-map: الشيكات (الوحدة 14)', () => {
  test('استلام شيك وارد: AR → CHQ', () => {
    const rule = getPosting('cheque_in_received');
    expect(rule.debit).toEqual(['CHQ']);
    expect(rule.credit).toEqual(['AR']);
  });

  test('تحصيل شيك وارد: CHQ → CASH (+FX إن لزم)', () => {
    const rule = getPosting('cheque_in_cleared');
    expect(rule.credit).toEqual(['CHQ']);
    expect(rule.debit).toContain('CASH');
    expect(rule.debit).toContain('FX');
  });

  test('ارتداد شيك وارد: CHQ → AR + CASH → EXP للرسم فقط', () => {
    const rule = getPosting('cheque_in_bounced');
    expect(rule.debit).toContain('AR');
    expect(rule.debit).toContain('EXP');
    expect(rule.credit).toContain('CHQ');
    expect(rule.credit).toContain('CASH');
    expect(rule.plLine).toBe('expenses');
  });

  test('إصدار شيك صادر: CHQ → AP، وصرفه: CASH → CHQ', () => {
    const issued = getPosting('cheque_out_issued');
    expect(issued.debit).toEqual(['AP']);
    expect(issued.credit).toEqual(['CHQ']);
    const cleared = getPosting('cheque_out_cleared');
    expect(cleared.debit).toEqual(['CHQ']);
    expect(cleared.credit).toEqual(['CASH']);
  });
});
