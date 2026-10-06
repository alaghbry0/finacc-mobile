/**
 * الهجرة 0001 — المخطط الكامل حرفياً من SRS §5.3 (v1.2).
 * idempotent: CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS على كل العناصر.
 * 31 جدولاً + فهارس + CHECK constraints + triggers حماية audit_log (append-only).
 */
export const migration = {
  version: 1,
  name: 'init_v1',
  up: `
-- ============ الترقيم الذري (قرار 6) ============
-- الاستهلاك داخل Transaction واحدة بـ UPSERT ذري (لا MAX+1 أبداً):
--   INSERT INTO doc_sequence(doc_type, year, last_no) VALUES(?, ?, 1)
--     ON CONFLICT(doc_type, year) DO UPDATE SET last_no = last_no + 1
--     RETURNING last_no;
CREATE TABLE IF NOT EXISTS doc_sequence (
  doc_type TEXT NOT NULL,              -- INV/PUR/SRN/PRN/RVT/PMT
  year INTEGER NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(doc_type, year)
);

-- ============ المراجع الأساسية ============
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT, whatsapp TEXT, address TEXT,
  logo_path TEXT,
  currency_id INTEGER NOT NULL REFERENCES currency(id),
  tax_number TEXT, tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  invoice_prefix TEXT DEFAULT 'INV',
  footer_text TEXT,
  created_at TEXT, updated_at TEXT, created_by INTEGER
);

CREATE TABLE IF NOT EXISTS currency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- YER, SAR, USD, AED
  name TEXT NOT NULL,
  symbol_svg TEXT,
  is_base INTEGER NOT NULL DEFAULT 0,
  decimals INTEGER NOT NULL DEFAULT 2, -- YER: 0
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS exchange_rate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency_id INTEGER NOT NULL REFERENCES currency(id),
  rate_date TEXT NOT NULL,             -- YYYY-MM-DD
  rate NUMERIC(14,6) NOT NULL CHECK(rate > 0),
  source TEXT DEFAULT 'manual',
  created_at TEXT, created_by INTEGER,
  UNIQUE(currency_id, rate_date)
);

CREATE TABLE IF NOT EXISTS category (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER REFERENCES category(id), sort_order INTEGER DEFAULT 0, is_archived INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, created_by INTEGER);
CREATE TABLE IF NOT EXISTS unit (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, base_unit_id INTEGER REFERENCES unit(id), factor NUMERIC(12,4) DEFAULT 1, is_archived INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, created_by INTEGER);

CREATE TABLE IF NOT EXISTS warehouse (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, location TEXT, is_default INTEGER DEFAULT 0, is_archived INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, created_by INTEGER);
CREATE TABLE IF NOT EXISTS cashbox (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, currency_id INTEGER NOT NULL REFERENCES currency(id), is_default INTEGER DEFAULT 0, is_archived INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, created_by INTEGER);
CREATE TABLE IF NOT EXISTS expense_category (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_archived INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, created_by INTEGER);

-- ============ الفترات المحاسبية (قرار 6 + م5) ============
CREATE TABLE IF NOT EXISTS fiscal_year (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL UNIQUE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_at TEXT, closed_by INTEGER,
  created_at TEXT, updated_at TEXT
);

-- ============ الأصناف والمخزون ============
CREATE TABLE IF NOT EXISTS product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  barcode TEXT UNIQUE,                 -- يبقى محجوزاً بعد الأرشفة
  category_id INTEGER REFERENCES category(id),
  unit_id INTEGER REFERENCES unit(id),
  cost_price NUMERIC(14,4) NOT NULL DEFAULT 0,       -- بالعملة الأساسية (WAC)
  min_stock NUMERIC(12,3) NOT NULL DEFAULT 0,
  is_service INTEGER NOT NULL DEFAULT 0,             -- صنف خدمي: بلا مخزون (قرار 5)
  track_batches INTEGER NOT NULL DEFAULT 0,          -- يُفعَّل مع وحدة V1.1
  track_serials INTEGER NOT NULL DEFAULT 0,
  image_path TEXT, notes TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT, created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_product_name ON product(name);
CREATE INDEX IF NOT EXISTS idx_product_barcode ON product(barcode);

CREATE TABLE IF NOT EXISTS product_price (           -- سعر البيع لكل عملة
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  currency_id INTEGER NOT NULL REFERENCES currency(id),
  price NUMERIC(14,4) NOT NULL CHECK(price >= 0),
  price_level TEXT NOT NULL DEFAULT 'retail' CHECK(price_level IN ('retail','wholesale','credit')),  -- V1: retail فقط (قرار 5)
  margin_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at TEXT,
  UNIQUE(product_id, currency_id, price_level)
);

CREATE TABLE IF NOT EXISTS stock_level (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  UNIQUE(product_id, warehouse_id),
  CHECK(qty >= 0)                      -- منع السالب المخزوني مطلق (قرار 9)
);

CREATE TABLE IF NOT EXISTS stock_movement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  movement_type TEXT NOT NULL CHECK(movement_type IN
    ('purchase','sale','sale_return','purchase_return',
     'stocktake_adjust','manual_adjust','transfer_in','transfer_out','opening')),
  qty NUMERIC(12,3) NOT NULL CHECK(qty <> 0),        -- موجب/سالب حسب النوع
  unit_cost NUMERIC(14,4) NOT NULL,                  -- كانت NULLable — ربح وهمي (إصلاح v1.2)
  ref_type TEXT, ref_id INTEGER,
  moved_at TEXT NOT NULL, notes TEXT,
  created_at TEXT, created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_move_product_date ON stock_movement(product_id, moved_at);
CREATE INDEX IF NOT EXISTS idx_move_warehouse ON stock_movement(warehouse_id, moved_at);
CREATE INDEX IF NOT EXISTS idx_move_ref ON stock_movement(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS batch (                   -- بنية باقية؛ الواجهات FEFO → V1.1
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  batch_number TEXT, serial_number TEXT UNIQUE,
  expiry_date TEXT,
  qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_batch_product ON batch(product_id, expiry_date);

CREATE TABLE IF NOT EXISTS stocktake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  counted_at TEXT NOT NULL,
  total_diff NUMERIC(14,4) DEFAULT 0,
  status TEXT DEFAULT 'completed', notes TEXT,
  created_at TEXT, created_by INTEGER
);
CREATE TABLE IF NOT EXISTS stocktake_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_id INTEGER NOT NULL REFERENCES stocktake(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  book_qty NUMERIC(12,3) NOT NULL,
  counted_qty NUMERIC(12,3) NOT NULL,
  diff_qty NUMERIC(12,3) NOT NULL,
  unit_cost NUMERIC(14,4) NOT NULL,    -- لقطة تكلفة وقت الجرد (إصلاح v1.2)
  created_at TEXT, created_by INTEGER
);

-- ============ الأطراف ============
CREATE TABLE IF NOT EXISTS customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT, whatsapp TEXT, address TEXT,
  area TEXT,
  credit_limit NUMERIC(14,4) DEFAULT NULL,           -- NULL = بلا حد؛ 0 = منع الآجل (إصلاح v1.2)
  opening_balance NUMERIC(14,4) DEFAULT 0,           -- موجب=مدين
  opening_balance_currency_id INTEGER REFERENCES currency(id),   -- إصلاح v1.2: للأرصدة بعملتها
  opening_balance_rate NUMERIC(12,6),
  opening_balance_date TEXT,
  notes TEXT, image_path TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT, created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_customer_name ON customer(name);
CREATE INDEX IF NOT EXISTS idx_customer_phone ON customer(phone);

CREATE TABLE IF NOT EXISTS supplier (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT, address TEXT,
  opening_balance NUMERIC(14,4) DEFAULT 0,           -- موجب=دائن (مستحق له)
  opening_balance_currency_id INTEGER REFERENCES currency(id),
  opening_balance_rate NUMERIC(12,6),
  opening_balance_date TEXT,
  notes TEXT, is_archived INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT, created_by INTEGER
);

-- ============ الفوترة ============
CREATE TABLE IF NOT EXISTS invoice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE,                            -- NULL لحالة draft — الرقم يُستهلك عند التحويل فقط (قرار 2)
  doc_type TEXT NOT NULL CHECK(doc_type IN ('sale','purchase','sale_return','purchase_return')),
  pay_status TEXT NOT NULL CHECK(pay_status IN ('cash','credit','mixed')),   -- حُذفت 'held' (قرار 2)
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft','completed','void')),  -- حُذفت 'converted'
  issued_at TEXT NOT NULL,
  converted_at TEXT,                                 -- تاريخ تحويل المسودة (أرشيفي)
  original_invoice_id INTEGER REFERENCES invoice(id),-- المرتجع المرتبط (إصلاح v1.2)
  due_date TEXT,                                     -- شروط ائتمان لأعمار الديون (إصلاح v1.2)
  customer_id INTEGER REFERENCES customer(id),
  supplier_id INTEGER REFERENCES supplier(id),
  sales_rep_id INTEGER,                              -- محجوز V2 — بلا FK (الجدول مؤجل)
  cashbox_id INTEGER REFERENCES cashbox(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouse(id),
  currency_id INTEGER NOT NULL REFERENCES currency(id),
  exchange_rate NUMERIC(12,6) NOT NULL,              -- حُذف DEFAULT 1 (قرار 3)
  rate_is_fallback INTEGER NOT NULL DEFAULT 0,       -- استُخدم آخر سعر معروف (قرار 3)
  subtotal NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
  total NUMERIC(14,4) NOT NULL CHECK(total > 0),     -- منع فاتورة صفرية (إصلاح v1.2)
  total_base NUMERIC(14,4) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
  due_amount NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK(due_amount >= 0),
  cost_total NUMERIC(14,4) NOT NULL DEFAULT 0,       -- تكلفة البنود للربح
  notes_internal TEXT, notes_printed TEXT,
  created_at TEXT, updated_at TEXT, created_by INTEGER,
  CHECK(paid_amount <= total)
);
CREATE INDEX IF NOT EXISTS idx_invoice_type_date ON invoice(doc_type, issued_at);
CREATE INDEX IF NOT EXISTS idx_invoice_customer ON invoice(customer_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_invoice_supplier ON invoice(supplier_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_invoice_no ON invoice(invoice_no);
CREATE INDEX IF NOT EXISTS idx_invoice_original ON invoice(original_invoice_id);

CREATE TABLE IF NOT EXISTS invoice_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoice(id),
  product_id INTEGER REFERENCES product(id),         -- NULLable لسطر خدمة حرة (قرار 5)
  line_desc TEXT,                                    -- وصف سطر الخدمة الحرة
  qty NUMERIC(12,3) NOT NULL CHECK(qty > 0),         -- إصلاح v1.2
  unit_id INTEGER REFERENCES unit(id),
  unit_factor NUMERIC(12,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,4) NOT NULL,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  discount_amount NUMERIC(14,4) DEFAULT 0,
  tax_percent NUMERIC(5,2) DEFAULT 0,
  line_total NUMERIC(14,4) NOT NULL,
  line_cost NUMERIC(14,4) NOT NULL DEFAULT 0,        -- التكلفة لحظة البيع ( Snapshot )
  batch_id INTEGER REFERENCES batch(id),             -- V1.1
  serial_numbers TEXT,
  notes TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_item_invoice ON invoice_item(invoice_id);
CREATE INDEX IF NOT EXISTS idx_item_product ON invoice_item(product_id);

-- ============ النقدية ============
CREATE TABLE IF NOT EXISTS cash_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_type TEXT NOT NULL CHECK(tx_type IN
    ('receipt','payment','expense','owner_draw','capital_in',
     'box_transfer','bank_deposit','bank_withdraw','opening',
     'employee_advance','commission_payout','salary_batch')),  -- الثلاث الأخيرة محجوزة V1.1/V2
  cashbox_id INTEGER NOT NULL REFERENCES cashbox(id),
  to_cashbox_id INTEGER REFERENCES cashbox(id),
  currency_id INTEGER NOT NULL REFERENCES currency(id),
  amount NUMERIC(14,4) NOT NULL CHECK(amount > 0),   -- الاتجاه من tx_type
  exchange_rate NUMERIC(12,6) NOT NULL,              -- حُذف DEFAULT 1 (قرار 3)
  settlement_rate NUMERIC(12,6),                     -- سعر يوم الدفع عند التسوية بعملة مختلفة (قرار 8)
  fx_gain_loss NUMERIC(14,4) NOT NULL DEFAULT 0,     -- فرق الصرف المحقق (قرار 8)
  voucher_no TEXT,                                   -- RVT-/PMT- عند طباعة سند (م4)
  tx_date TEXT NOT NULL,
  ref_type TEXT, ref_id INTEGER,                     -- invoice/installment/stocktake/transfer/on_account
  expense_category_id INTEGER REFERENCES expense_category(id),
  employee_id INTEGER,                               -- محجوز V1.1 (بلا FK)
  customer_id INTEGER REFERENCES customer(id),
  supplier_id INTEGER REFERENCES supplier(id),
  is_voided INTEGER NOT NULL DEFAULT 0,              -- إصلاح v1.2: تمثيل الحركة المعاكسة
  reversal_of INTEGER REFERENCES cash_tx(id),
  description TEXT,
  created_at TEXT, created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cash_tx_date ON cash_tx(tx_date);
CREATE INDEX IF NOT EXISTS idx_cash_tx_box ON cash_tx(cashbox_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_cash_tx_ref ON cash_tx(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_cash_tx_voucher ON cash_tx(voucher_no);

-- تخصيص المدفوعات (إصلاح v1.2): سند واحد يغطي عدة فواتير + قبض حر on_account
CREATE TABLE IF NOT EXISTS payment_allocation (
  cash_tx_id INTEGER NOT NULL REFERENCES cash_tx(id),
  invoice_id INTEGER NOT NULL REFERENCES invoice(id),
  allocated_amount NUMERIC(14,4) NOT NULL CHECK(allocated_amount > 0),
  allocated_at TEXT NOT NULL, created_by INTEGER,
  PRIMARY KEY(cash_tx_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_alloc_invoice ON payment_allocation(invoice_id);

CREATE TABLE IF NOT EXISTS shift (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cashbox_id INTEGER NOT NULL REFERENCES cashbox(id),
  user_id INTEGER REFERENCES app_user(id),
  opened_at TEXT NOT NULL, closed_at TEXT,
  opening_count NUMERIC(14,4),
  expected NUMERIC(14,4), counted NUMERIC(14,4),
  difference NUMERIC(14,4), notes TEXT,
  created_at TEXT, updated_at TEXT
);

-- ============ الشيكات (وحدة 14 — جديدة في v1.2) ============
CREATE TABLE IF NOT EXISTS cheque (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  party_type TEXT NOT NULL CHECK(party_type IN ('customer','supplier')),
  party_id INTEGER NOT NULL,
  cheque_no TEXT NOT NULL, bank_name TEXT,
  amount NUMERIC(14,4) NOT NULL CHECK(amount > 0),
  currency_id INTEGER NOT NULL REFERENCES currency(id),
  exchange_rate NUMERIC(12,6) NOT NULL,
  issue_date TEXT NOT NULL, due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','deposited','cleared','bounced','void')),
  bounced_at TEXT, bounce_fee NUMERIC(14,4) DEFAULT 0,
  ref_invoice_id INTEGER REFERENCES invoice(id),
  cleared_cash_tx_id INTEGER REFERENCES cash_tx(id),
  notes TEXT,
  created_at TEXT, updated_at TEXT, created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cheque_due ON cheque(due_date, status);
CREATE INDEX IF NOT EXISTS idx_cheque_party ON cheque(party_type, party_id);

-- ============ التقسيط ============
CREATE TABLE IF NOT EXISTS installment_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customer(id),
  invoice_id INTEGER NOT NULL REFERENCES invoice(id), -- من فاتورة آجلة فقط (منع «مبلغ مخصص»)
  currency_id INTEGER NOT NULL REFERENCES currency(id),
  exchange_rate NUMERIC(12,6) NOT NULL,              -- Snapshot وقت الإنشاء (إصلاح v1.2)
  principal NUMERIC(14,4) NOT NULL,
  down_payment NUMERIC(14,4) DEFAULT 0,
  down_payment_cash_tx_id INTEGER REFERENCES cash_tx(id),  -- ربط الدفعة الأولى بحركة صندوق (إصلاح v1.2)
  months INTEGER NOT NULL, cycle TEXT DEFAULT 'monthly' CHECK(cycle IN ('monthly','weekly')),
  first_due TEXT NOT NULL,
  total_paid NUMERIC(14,4) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','defaulted','cancelled')),
  created_at TEXT, updated_at TEXT, created_by INTEGER
);

CREATE TABLE IF NOT EXISTS installment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES installment_plan(id),
  seq INTEGER NOT NULL,
  due_date TEXT NOT NULL, amount NUMERIC(14,4) NOT NULL,
  paid_amount NUMERIC(14,4) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','partial','paid','late')),
  paid_at TEXT, cash_tx_id INTEGER REFERENCES cash_tx(id),
  created_at TEXT, updated_at TEXT,
  UNIQUE(plan_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_installment_due ON installment(due_date, status);

-- ============ المستخدمون والأمان ============
CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','cashier','viewer')),  -- V1: admin فقط
  pin_hash TEXT,                                     -- Argon2id
  failed_attempts INTEGER NOT NULL DEFAULT 0,        -- سياسة قفل PIN (قرار 4)
  locked_until TEXT,
  permissions TEXT NOT NULL DEFAULT '{}',            -- تُفعَّل V1.1
  default_cashbox_id INTEGER REFERENCES cashbox(id),
  is_active INTEGER DEFAULT 1,
  last_login_at TEXT, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES app_user(id),
  action TEXT NOT NULL,                              -- void_invoice, price_override, fx_edit, stocktake, backdate, restore_backup, cheque_bounce...
  entity TEXT, entity_id INTEGER,
  details TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
-- حماية داخل الملف: السجل للإضافة فقط (FR-12-04)
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('manual','auto','cloud','pre_restore')),
  file_name TEXT, file_size INTEGER, checksum TEXT,
  cloud_path TEXT,                                   -- V1.1
  status TEXT DEFAULT 'ok', at TEXT NOT NULL, user_id INTEGER,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                               -- JSON مُتحقق بـ zod حسب مخطط ملحق هـ
  updated_at TEXT, updated_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT);
`,
};
