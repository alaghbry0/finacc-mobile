import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  numeric,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * تعريف Drizzle الكامل لجداول SRS §5.3 (v1.2) — مطابق حرفياً لأعمدة DDL.
 * مصدر الأنواع لكل المشروع (المبالغ NUMERIC(14,4) في DDL — تُقرأ Decimal وتُخزن نصاً).
 * ملاحظة معمارية: DDL الفعلي ينفذه src/db/migrations/0001_init.ts — هذا الملف
 * للأنواع والاستعلام المنمّق فقط، والمعاملات عبر engine.transaction() لا drizzle.
 * انحراف موثق: drizzle sqlite-core numeric لا يقبل precision/scale (NUMERIC في SQLite
 * affinity فقط بلا دقة) — الدقة الكاملة محفوظة في نص الهجرة الخام.
 */

// ============ الترقيم الذري (قرار 6) ============
export const docSequence = sqliteTable(
  'doc_sequence',
  {
    docType: text('doc_type').notNull(),
    year: integer('year').notNull(),
    lastNo: integer('last_no').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.docType, t.year] })],
);

// ============ المراجع الأساسية ============
export const currency = sqliteTable('currency', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  symbolSvg: text('symbol_svg'),
  isBase: integer('is_base').notNull().default(0),
  decimals: integer('decimals').notNull().default(2),
  isActive: integer('is_active').notNull().default(1),
});

export const company = sqliteTable('company', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  whatsapp: text('whatsapp'),
  address: text('address'),
  logoPath: text('logo_path'),
  currencyId: integer('currency_id')
    .notNull()
    .references(() => currency.id),
  taxNumber: text('tax_number'),
  taxRate: numeric('tax_rate').notNull().default('0'),
  invoicePrefix: text('invoice_prefix').default('INV'),
  footerText: text('footer_text'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  createdBy: integer('created_by'),
});

export const exchangeRate = sqliteTable(
  'exchange_rate',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    currencyId: integer('currency_id')
      .notNull()
      .references(() => currency.id),
    rateDate: text('rate_date').notNull(),
    rate: numeric('rate').notNull(),
    source: text('source').default('manual'),
    createdAt: text('created_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    uniqueIndex('uq_exchange_rate_currency_date').on(t.currencyId, t.rateDate),
    check('ck_exchange_rate_positive', sql`rate > 0`),
  ],
);

export const category = sqliteTable('category', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => category.id),
  sortOrder: integer('sort_order').default(0),
  isArchived: integer('is_archived').default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  createdBy: integer('created_by'),
});

export const unit = sqliteTable('unit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  baseUnitId: integer('base_unit_id').references((): AnySQLiteColumn => unit.id),
  factor: numeric('factor').default('1'),
  isArchived: integer('is_archived').default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  createdBy: integer('created_by'),
});

export const warehouse = sqliteTable('warehouse', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  location: text('location'),
  isDefault: integer('is_default').default(0),
  isArchived: integer('is_archived').default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  createdBy: integer('created_by'),
});

export const cashbox = sqliteTable('cashbox', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  currencyId: integer('currency_id')
    .notNull()
    .references(() => currency.id),
  isDefault: integer('is_default').default(0),
  isArchived: integer('is_archived').default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  createdBy: integer('created_by'),
});

export const expenseCategory = sqliteTable('expense_category', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  isArchived: integer('is_archived').default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  createdBy: integer('created_by'),
});

// ============ الفترات المحاسبية (قرار 6 + م5) ============
export const fiscalYear = sqliteTable(
  'fiscal_year',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    year: integer('year').notNull().unique(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    status: text('status').notNull().default('open'),
    closedAt: text('closed_at'),
    closedBy: integer('closed_by'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (t) => [check('ck_fiscal_year_status', sql`status IN ('open','closed')`)],
);

// ============ الأصناف والمخزون ============
export const product = sqliteTable(
  'product',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    barcode: text('barcode').unique(),
    categoryId: integer('category_id').references(() => category.id),
    unitId: integer('unit_id').references(() => unit.id),
    costPrice: numeric('cost_price').notNull().default('0'),
    minStock: numeric('min_stock').notNull().default('0'),
    isService: integer('is_service').notNull().default(0),
    trackBatches: integer('track_batches').notNull().default(0),
    trackSerials: integer('track_serials').notNull().default(0),
    imagePath: text('image_path'),
    notes: text('notes'),
    isArchived: integer('is_archived').notNull().default(0),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_product_name').on(t.name),
    index('idx_product_barcode').on(t.barcode),
  ],
);

export const productPrice = sqliteTable(
  'product_price',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => product.id),
    currencyId: integer('currency_id')
      .notNull()
      .references(() => currency.id),
    price: numeric('price').notNull(),
    priceLevel: text('price_level').notNull().default('retail'),
    marginPercent: numeric('margin_percent').notNull().default('0'),
    updatedAt: text('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_product_price').on(t.productId, t.currencyId, t.priceLevel),
    check('ck_product_price_nonneg', sql`price >= 0`),
    check('ck_product_price_level', sql`price_level IN ('retail','wholesale','credit')`),
  ],
);

export const stockLevel = sqliteTable(
  'stock_level',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => product.id),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    qty: numeric('qty').notNull().default('0'),
  },
  (t) => [
    uniqueIndex('uq_stock_level').on(t.productId, t.warehouseId),
    // منع السالب المخزوني مطلق (قرار 9)
    check('ck_stock_level_qty_nonneg', sql`qty >= 0`),
  ],
);

export const stockMovement = sqliteTable(
  'stock_movement',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => product.id),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    movementType: text('movement_type').notNull(),
    qty: numeric('qty').notNull(),
    unitCost: numeric('unit_cost').notNull(),
    refType: text('ref_type'),
    refId: integer('ref_id'),
    movedAt: text('moved_at').notNull(),
    notes: text('notes'),
    createdAt: text('created_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_move_product_date').on(t.productId, t.movedAt),
    index('idx_move_warehouse').on(t.warehouseId, t.movedAt),
    index('idx_move_ref').on(t.refType, t.refId),
    check(
      'ck_stock_movement_type',
      sql`movement_type IN ('purchase','sale','sale_return','purchase_return','stocktake_adjust','manual_adjust','transfer_in','transfer_out','opening')`,
    ),
    check('ck_stock_movement_qty_nonzero', sql`qty <> 0`),
  ],
);

export const batch = sqliteTable(
  'batch',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => product.id),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    batchNumber: text('batch_number'),
    serialNumber: text('serial_number').unique(),
    expiryDate: text('expiry_date'),
    qty: numeric('qty').notNull().default('0'),
    isArchived: integer('is_archived').default(0),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (t) => [index('idx_batch_product').on(t.productId, t.expiryDate)],
);

export const stocktake = sqliteTable('stocktake', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  warehouseId: integer('warehouse_id')
    .notNull()
    .references(() => warehouse.id),
  countedAt: text('counted_at').notNull(),
  totalDiff: numeric('total_diff').default('0'),
  status: text('status').default('completed'),
  notes: text('notes'),
  createdAt: text('created_at'),
  createdBy: integer('created_by'),
});

export const stocktakeLine = sqliteTable('stocktake_line', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  stocktakeId: integer('stocktake_id')
    .notNull()
    .references(() => stocktake.id),
  productId: integer('product_id')
    .notNull()
    .references(() => product.id),
  bookQty: numeric('book_qty').notNull(),
  countedQty: numeric('counted_qty').notNull(),
  diffQty: numeric('diff_qty').notNull(),
  unitCost: numeric('unit_cost').notNull(),
  createdAt: text('created_at'),
  createdBy: integer('created_by'),
});

// ============ الأطراف ============
export const customer = sqliteTable(
  'customer',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    address: text('address'),
    area: text('area'),
    creditLimit: numeric('credit_limit'),
    openingBalance: numeric('opening_balance').default('0'),
    openingBalanceCurrencyId: integer('opening_balance_currency_id').references(() => currency.id),
    openingBalanceRate: numeric('opening_balance_rate'),
    openingBalanceDate: text('opening_balance_date'),
    notes: text('notes'),
    imagePath: text('image_path'),
    isArchived: integer('is_archived').notNull().default(0),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_customer_name').on(t.name),
    index('idx_customer_phone').on(t.phone),
  ],
);

export const supplier = sqliteTable('supplier', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  openingBalance: numeric('opening_balance').default('0'),
  openingBalanceCurrencyId: integer('opening_balance_currency_id').references(() => currency.id),
  openingBalanceRate: numeric('opening_balance_rate'),
  openingBalanceDate: text('opening_balance_date'),
  notes: text('notes'),
  isArchived: integer('is_archived').default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  createdBy: integer('created_by'),
});

// ============ الفوترة ============
export const invoice = sqliteTable(
  'invoice',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceNo: text('invoice_no').unique(),
    docType: text('doc_type').notNull(),
    payStatus: text('pay_status').notNull(),
    status: text('status').notNull().default('completed'),
    issuedAt: text('issued_at').notNull(),
    convertedAt: text('converted_at'),
    originalInvoiceId: integer('original_invoice_id').references((): AnySQLiteColumn => invoice.id),
    dueDate: text('due_date'),
    customerId: integer('customer_id').references(() => customer.id),
    supplierId: integer('supplier_id').references(() => supplier.id),
    salesRepId: integer('sales_rep_id'),
    cashboxId: integer('cashbox_id').references(() => cashbox.id),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    currencyId: integer('currency_id')
      .notNull()
      .references(() => currency.id),
    exchangeRate: numeric('exchange_rate').notNull(),
    rateIsFallback: integer('rate_is_fallback').notNull().default(0),
    subtotal: numeric('subtotal').notNull().default('0'),
    discountAmount: numeric('discount_amount').notNull().default('0'),
    taxRate: numeric('tax_rate').notNull().default('0'),
    taxAmount: numeric('tax_amount').notNull().default('0'),
    total: numeric('total').notNull(),
    totalBase: numeric('total_base').notNull().default('0'),
    paidAmount: numeric('paid_amount').notNull().default('0'),
    dueAmount: numeric('due_amount').notNull().default('0'),
    costTotal: numeric('cost_total').notNull().default('0'),
    notesInternal: text('notes_internal'),
    notesPrinted: text('notes_printed'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_invoice_type_date').on(t.docType, t.issuedAt),
    index('idx_invoice_customer').on(t.customerId, t.issuedAt),
    index('idx_invoice_supplier').on(t.supplierId, t.issuedAt),
    index('idx_invoice_no').on(t.invoiceNo),
    index('idx_invoice_original').on(t.originalInvoiceId),
    check('ck_invoice_doc_type', sql`doc_type IN ('sale','purchase','sale_return','purchase_return')`),
    check('ck_invoice_pay_status', sql`pay_status IN ('cash','credit','mixed')`),
    check('ck_invoice_status', sql`status IN ('draft','completed','void')`),
    check('ck_invoice_total_positive', sql`total > 0`),
    check('ck_invoice_due_nonneg', sql`due_amount >= 0`),
    check('ck_invoice_paid_le_total', sql`paid_amount <= total`),
  ],
);

export const invoiceItem = sqliteTable(
  'invoice_item',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoice.id),
    productId: integer('product_id').references(() => product.id),
    lineDesc: text('line_desc'),
    qty: numeric('qty').notNull(),
    unitId: integer('unit_id').references(() => unit.id),
    unitFactor: numeric('unit_factor').notNull().default('1'),
    unitPrice: numeric('unit_price').notNull(),
    discountPercent: numeric('discount_percent').default('0'),
    discountAmount: numeric('discount_amount').default('0'),
    taxPercent: numeric('tax_percent').default('0'),
    lineTotal: numeric('line_total').notNull(),
    lineCost: numeric('line_cost').notNull().default('0'),
    batchId: integer('batch_id').references(() => batch.id),
    serialNumbers: text('serial_numbers'),
    notes: text('notes'),
    createdAt: text('created_at'),
  },
  (t) => [
    index('idx_item_invoice').on(t.invoiceId),
    index('idx_item_product').on(t.productId),
    check('ck_invoice_item_qty_positive', sql`qty > 0`),
  ],
);

// ============ النقدية ============
export const cashTx = sqliteTable(
  'cash_tx',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    txType: text('tx_type').notNull(),
    cashboxId: integer('cashbox_id')
      .notNull()
      .references(() => cashbox.id),
    toCashboxId: integer('to_cashbox_id').references(() => cashbox.id),
    currencyId: integer('currency_id')
      .notNull()
      .references(() => currency.id),
    amount: numeric('amount').notNull(),
    exchangeRate: numeric('exchange_rate').notNull(),
    settlementRate: numeric('settlement_rate'),
    fxGainLoss: numeric('fx_gain_loss').notNull().default('0'),
    voucherNo: text('voucher_no'),
    txDate: text('tx_date').notNull(),
    refType: text('ref_type'),
    refId: integer('ref_id'),
    expenseCategoryId: integer('expense_category_id').references(() => expenseCategory.id),
    employeeId: integer('employee_id'),
    customerId: integer('customer_id').references(() => customer.id),
    supplierId: integer('supplier_id').references(() => supplier.id),
    isVoided: integer('is_voided').notNull().default(0),
    reversalOf: integer('reversal_of').references((): AnySQLiteColumn => cashTx.id),
    description: text('description'),
    createdAt: text('created_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_cash_tx_date').on(t.txDate),
    index('idx_cash_tx_box').on(t.cashboxId, t.txDate),
    index('idx_cash_tx_ref').on(t.refType, t.refId),
    index('idx_cash_tx_voucher').on(t.voucherNo),
    check(
      'ck_cash_tx_type',
      sql`tx_type IN ('receipt','payment','expense','owner_draw','capital_in','box_transfer','bank_deposit','bank_withdraw','opening','employee_advance','commission_payout','salary_batch')`,
    ),
    check('ck_cash_tx_amount_positive', sql`amount > 0`),
  ],
);

export const paymentAllocation = sqliteTable(
  'payment_allocation',
  {
    cashTxId: integer('cash_tx_id')
      .notNull()
      .references(() => cashTx.id),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoice.id),
    allocatedAmount: numeric('allocated_amount').notNull(),
    allocatedAt: text('allocated_at').notNull(),
    createdBy: integer('created_by'),
  },
  (t) => [
    primaryKey({ columns: [t.cashTxId, t.invoiceId] }),
    index('idx_alloc_invoice').on(t.invoiceId),
    check('ck_payment_allocation_positive', sql`allocated_amount > 0`),
  ],
);

export const shift = sqliteTable('shift', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cashboxId: integer('cashbox_id')
    .notNull()
    .references(() => cashbox.id),
  userId: integer('user_id').references(() => appUser.id),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
  openingCount: numeric('opening_count'),
  expected: numeric('expected'),
  counted: numeric('counted'),
  difference: numeric('difference'),
  notes: text('notes'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

// ============ الشيكات (وحدة 14) ============
export const cheque = sqliteTable(
  'cheque',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    direction: text('direction').notNull(),
    partyType: text('party_type').notNull(),
    partyId: integer('party_id').notNull(),
    chequeNo: text('cheque_no').notNull(),
    bankName: text('bank_name'),
    amount: numeric('amount').notNull(),
    currencyId: integer('currency_id')
      .notNull()
      .references(() => currency.id),
    exchangeRate: numeric('exchange_rate').notNull(),
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date').notNull(),
    status: text('status').notNull().default('pending'),
    bouncedAt: text('bounced_at'),
    bounceFee: numeric('bounce_fee').default('0'),
    refInvoiceId: integer('ref_invoice_id').references(() => invoice.id),
    clearedCashTxId: integer('cleared_cash_tx_id').references(() => cashTx.id),
    notes: text('notes'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    index('idx_cheque_due').on(t.dueDate, t.status),
    index('idx_cheque_party').on(t.partyType, t.partyId),
    check('ck_cheque_direction', sql`direction IN ('in','out')`),
    check('ck_cheque_party_type', sql`party_type IN ('customer','supplier')`),
    check('ck_cheque_amount_positive', sql`amount > 0`),
    check('ck_cheque_status', sql`status IN ('pending','deposited','cleared','bounced','void')`),
  ],
);

// ============ التقسيط ============
export const installmentPlan = sqliteTable(
  'installment_plan',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customer.id),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoice.id),
    currencyId: integer('currency_id')
      .notNull()
      .references(() => currency.id),
    exchangeRate: numeric('exchange_rate').notNull(),
    principal: numeric('principal').notNull(),
    downPayment: numeric('down_payment').default('0'),
    downPaymentCashTxId: integer('down_payment_cash_tx_id').references(() => cashTx.id),
    months: integer('months').notNull(),
    cycle: text('cycle').default('monthly'),
    firstDue: text('first_due').notNull(),
    totalPaid: numeric('total_paid').default('0'),
    status: text('status').default('active'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    createdBy: integer('created_by'),
  },
  (t) => [
    check('ck_installment_plan_cycle', sql`cycle IN ('monthly','weekly')`),
    check('ck_installment_plan_status', sql`status IN ('active','completed','defaulted','cancelled')`),
  ],
);

export const installment = sqliteTable(
  'installment',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    planId: integer('plan_id')
      .notNull()
      .references(() => installmentPlan.id),
    seq: integer('seq').notNull(),
    dueDate: text('due_date').notNull(),
    amount: numeric('amount').notNull(),
    paidAmount: numeric('paid_amount').default('0'),
    status: text('status').default('pending'),
    paidAt: text('paid_at'),
    cashTxId: integer('cash_tx_id').references(() => cashTx.id),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_installment_plan_seq').on(t.planId, t.seq),
    index('idx_installment_due').on(t.dueDate, t.status),
    check('ck_installment_status', sql`status IN ('pending','partial','paid','late')`),
  ],
);

// ============ المستخدمون والأمان ============
export const appUser = sqliteTable(
  'app_user',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull().unique(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().default('admin'),
    pinHash: text('pin_hash'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: text('locked_until'),
    permissions: text('permissions').notNull().default('{}'),
    defaultCashboxId: integer('default_cashbox_id').references(() => cashbox.id),
    isActive: integer('is_active').default(1),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
  },
  (t) => [check('ck_app_user_role', sql`role IN ('admin','cashier','viewer')`)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => appUser.id),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: integer('entity_id'),
    details: text('details'),
    at: text('at').notNull(),
  },
  (t) => [
    index('idx_audit_at').on(t.at),
    // FR-12-04: الحماية append-only مطبقة داخل الملف عبر triggers في الهجرة 0001
  ],
);

export const backupLog = sqliteTable(
  'backup_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    checksum: text('checksum'),
    cloudPath: text('cloud_path'),
    status: text('status').default('ok'),
    at: text('at').notNull(),
    userId: integer('user_id'),
    createdAt: text('created_at'),
  },
  (t) => [check('ck_backup_log_kind', sql`kind IN ('manual','auto','cloud','pre_restore')`)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at'),
  updatedBy: integer('updated_by'),
});

export const migrationsTable = sqliteTable('_migrations', {
  id: integer('id').primaryKey(),
  version: integer('version').notNull(),
  appliedAt: text('applied_at'),
});

// ============ كائن المخطط الموحد ============
export const schema = {
  docSequence,
  company,
  currency,
  exchangeRate,
  category,
  unit,
  warehouse,
  cashbox,
  expenseCategory,
  fiscalYear,
  product,
  productPrice,
  stockLevel,
  stockMovement,
  batch,
  stocktake,
  stocktakeLine,
  customer,
  supplier,
  invoice,
  invoiceItem,
  cashTx,
  paymentAllocation,
  shift,
  cheque,
  installmentPlan,
  installment,
  appUser,
  auditLog,
  backupLog,
  settings,
  migrations: migrationsTable,
};

// ============ الأنواع المستدلة (Insert/Select) ============
export type DocSequence = typeof docSequence.$inferSelect;
export type Company = typeof company.$inferSelect;
export type Currency = typeof currency.$inferSelect;
export type ExchangeRate = typeof exchangeRate.$inferSelect;
export type Category = typeof category.$inferSelect;
export type Unit = typeof unit.$inferSelect;
export type Warehouse = typeof warehouse.$inferSelect;
export type Cashbox = typeof cashbox.$inferSelect;
export type ExpenseCategory = typeof expenseCategory.$inferSelect;
export type FiscalYear = typeof fiscalYear.$inferSelect;
export type Product = typeof product.$inferSelect;
export type ProductPrice = typeof productPrice.$inferSelect;
export type StockLevel = typeof stockLevel.$inferSelect;
export type StockMovement = typeof stockMovement.$inferSelect;
export type Batch = typeof batch.$inferSelect;
export type Stocktake = typeof stocktake.$inferSelect;
export type StocktakeLine = typeof stocktakeLine.$inferSelect;
export type Customer = typeof customer.$inferSelect;
export type Supplier = typeof supplier.$inferSelect;
export type Invoice = typeof invoice.$inferSelect;
export type InvoiceItem = typeof invoiceItem.$inferSelect;
export type CashTx = typeof cashTx.$inferSelect;
export type PaymentAllocation = typeof paymentAllocation.$inferSelect;
export type Shift = typeof shift.$inferSelect;
export type Cheque = typeof cheque.$inferSelect;
export type InstallmentPlan = typeof installmentPlan.$inferSelect;
export type Installment = typeof installment.$inferSelect;
export type AppUser = typeof appUser.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type BackupLog = typeof backupLog.$inferSelect;
export type Settings = typeof settings.$inferSelect;
