import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import {
  AppCard,
  BottomSheet,
  PrimaryButton,
  SectionTitle,
  SelectField,
  TextField,
} from '@/components';
import { common, fill, inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import { generateEan13 } from '@/utils/barcode';
import { listActiveCurrencies, type CurrencyRow } from '@/domain/currency';
import {
  createProduct,
  listCategories,
  listUnits,
  listWarehouses,
  updateProduct,
  upsertCategory,
  upsertUnit,
  type CategoryNode,
  type ProductInput,
  type UnitRow,
  type WarehouseRow,
} from '@/domain/inventory';
import { useToastStore } from '@/store/toast';
import { AmountPadField } from './AmountPadSheet';

export interface ProductFormValues {
  name: string;
  barcode: string;
  categoryId: string | null;
  unitId: string | null;
  warehouseId: string | null;
  costPrice: string;
  minStock: string;
  isService: boolean;
  notes: string;
  openingQty: string;
  /** currencyId (نصاً) → السعر الخام */
  prices: Record<string, string>;
}

interface ProductFormProps {
  mode: 'create' | 'edit';
  /** في وضع التعديل فقط. */
  productId?: number;
  /** قيم مبدئية (وضع التعديل). */
  initial?: Partial<ProductFormValues>;
  /** يُستدعى بعد الحفظ الناجح (عادة: رجوع). */
  onSaved: () => void;
}

const NEW_OPTION = '__new__';

function emptyValues(): ProductFormValues {
  return {
    name: '',
    barcode: '',
    categoryId: null,
    unitId: null,
    warehouseId: null,
    costPrice: '',
    minStock: '',
    isService: false,
    notes: '',
    openingQty: '',
    prices: {},
  };
}

/**
 * ProductForm — نموذج الصنف المشترك للإنشاء والتعديل (FR-01-01):
 * البيانات الأساسية + أسعار بيع لكل عملة مفعلة (retail) + المخزون (خدمي/افتتاحي).
 * الإدخال الرقمي كله عبر NumberPad في BottomSheet، والأخطاء تحت الحقول.
 */
export function ProductForm({ mode, productId, initial, onSaved }: ProductFormProps) {
  const [v, setV] = useState<ProductFormValues>({ ...emptyValues(), ...initial });
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // شيتا الإنشاء السريع للفئة/الوحدة
  const [catSheet, setCatSheet] = useState(false);
  const [catName, setCatName] = useState('');
  const [catParent, setCatParent] = useState<string | null>(null);
  const [unitSheet, setUnitSheet] = useState(false);
  const [unitName, setUnitName] = useState('');
  const [unitBase, setUnitBase] = useState<string | null>(null);
  const [unitFactor, setUnitFactor] = useState('');

  const toast = useToastStore((s) => s.show);

  const loadRefs = useCallback(async () => {
    try {
      const [curs, cats, uns, whs] = await Promise.all([
        listActiveCurrencies(),
        listCategories(),
        listUnits(),
        listWarehouses(),
      ]);
      setCurrencies(curs);
      setCategories(cats);
      setUnits(uns);
      setWarehouses(whs);
      if (mode === 'create') {
        const def = whs.find((w) => w.isDefault) ?? whs[0];
        setV((prev) => (prev.warehouseId === null ? { ...prev, warehouseId: def ? String(def.id) : null } : prev));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    }
  }, [mode, toast]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  // ---- خيارات الاختيار ----
  const categoryOptions = (() => {
    const opts: { value: string; label: string }[] = [];
    for (const c of categories) {
      opts.push({ value: String(c.id), label: c.name });
      for (const child of c.children) {
        opts.push({ value: String(child.id), label: `— ${child.name}` });
      }
    }
    return opts;
  })();

  const unitOptions = units.map((u) => ({
    value: String(u.id),
    label: u.baseUnitId !== null ? `${u.name} (تحويل)` : u.name,
  }));

  const warehouseOptions = warehouses.map((w) => ({
    value: String(w.id),
    label: w.isDefault ? `${w.name} — افتراضي` : w.name,
  }));

  const topLevelCategoryOptions = categories.map((c) => ({ value: String(c.id), label: c.name }));
  const baseUnitOptions = units
    .filter((u) => u.baseUnitId === null)
    .map((u) => ({ value: String(u.id), label: u.name }));

  const baseCurrency = currencies.find((c) => Number(c.is_base) === 1) ?? currencies[0];

  // ---- الحفظ ----
  const save = async () => {
    if (v.name.trim() === '') {
      setNameError(t.nameRequired);
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      const prices = currencies
        .map((c) => ({ currencyId: c.id, price: (v.prices[String(c.id)] ?? '').trim() }))
        .filter((p) => p.price !== '');
      const input: ProductInput = {
        name: v.name.trim(),
        barcode: v.barcode.trim(),
        categoryId: v.categoryId !== null && v.categoryId !== '' ? Number(v.categoryId) : undefined,
        unitId: v.unitId !== null && v.unitId !== '' ? Number(v.unitId) : undefined,
        costPrice: v.costPrice.trim() !== '' ? v.costPrice.trim() : undefined,
        minStock: v.minStock.trim() !== '' ? v.minStock.trim() : undefined,
        isService: v.isService,
        notes: v.notes.trim() !== '' ? v.notes.trim() : undefined,
        prices,
      };
      if (mode === 'create' && !v.isService) {
        input.openingQty = v.openingQty.trim() !== '' ? v.openingQty.trim() : undefined;
        input.openingWarehouseId = v.warehouseId !== null && v.warehouseId !== '' ? Number(v.warehouseId) : undefined;
      }
      if (mode === 'create') {
        await createProduct(input);
        toast(t.createdToast);
      } else {
        if (productId === undefined) throw new Error('معرّف الصنف مفقود في وضع التعديل');
        await updateProduct(productId, input);
        toast(t.updatedToast);
      }
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setSaving(false);
    }
  };

  // ---- إنشاء فئة سريع ----
  const saveNewCategory = async () => {
    try {
      const id = await upsertCategory(null, catName, catParent !== null ? Number(catParent) : undefined);
      setCatSheet(false);
      setCatName('');
      setCatParent(null);
      setV((prev) => ({ ...prev, categoryId: String(id) }));
      await loadRefs();
      toast(t.categoriesTitle);
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    }
  };

  // ---- إنشاء وحدة سريع ----
  const saveNewUnit = async () => {
    try {
      const id = await upsertUnit(null, unitName, unitBase !== null ? Number(unitBase) : undefined, unitFactor);
      setUnitSheet(false);
      setUnitName('');
      setUnitBase(null);
      setUnitFactor('');
      setV((prev) => ({ ...prev, unitId: String(id) }));
      await loadRefs();
      toast(t.unitsTitle);
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    }
  };

  return (
    <>
      <SectionTitle title={t.sectionBasic} />
      <AppCard style={s.card}>
        <TextField
          label={t.nameLabel}
          value={v.name}
          onChangeText={(x) => {
            setV((p) => ({ ...p, name: x }));
            if (x.trim() !== '') setNameError(null);
          }}
          error={nameError}
          required
          placeholder={t.namePlaceholder}
        />
        <View style={s.barcodeRow}>
          <TextField
            label={t.barcodeLabel}
            value={v.barcode}
            onChangeText={(x) => setV((p) => ({ ...p, barcode: x }))}
            hint={t.barcodeHint}
            placeholder="—"
            keyboardType="numeric"
            style={s.barcodeField}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.generateBarcode}
            onPress={() => setV((p) => ({ ...p, barcode: generateEan13() }))}
            style={({ pressed }) => [s.genBtn, pressed && s.pressed]}
          >
            <RefreshCw size={20} color={colors.accent} />
          </Pressable>
        </View>
        <SelectField
          label={t.categoryLabel}
          value={v.categoryId}
          placeholder={t.categoryPlaceholder}
          searchable={false}
          options={[
            { value: NEW_OPTION, label: t.newCategory },
            ...categoryOptions,
          ]}
          onSelect={(val) => {
            if (val === NEW_OPTION) {
              setCatSheet(true);
              return;
            }
            setV((p) => ({ ...p, categoryId: val }));
          }}
        />
        <SelectField
          label={t.unitLabel}
          value={v.unitId}
          placeholder={t.unitPlaceholder}
          searchable={false}
          options={[{ value: NEW_OPTION, label: t.newUnit }, ...unitOptions]}
          onSelect={(val) => {
            if (val === NEW_OPTION) {
              setUnitSheet(true);
              return;
            }
            setV((p) => ({ ...p, unitId: val }));
          }}
        />
        <TextField
          label={t.notesLabel}
          value={v.notes}
          onChangeText={(x) => setV((p) => ({ ...p, notes: x }))}
          placeholder={t.notesPlaceholder}
          multiline
        />
      </AppCard>

      <SectionTitle title={t.sectionPricing} style={s.sectionGap} />
      <AppCard style={s.card}>
        <AmountPadField
          label={t.costPriceLabel}
          value={v.costPrice}
          onValue={(x) => setV((p) => ({ ...p, costPrice: x }))}
          suffix={baseCurrency?.code}
          hint={t.costPriceHint}
        />
        <AmountPadField
          label={t.minStockLabel}
          value={v.minStock}
          onValue={(x) => setV((p) => ({ ...p, minStock: x }))}
          hint={t.minStockHint}
          allowDecimal
        />
        <View style={s.pricesHintWrap}>
          <Text style={s.pricesHint}>{t.pricesHint}</Text>
        </View>
        {currencies.map((c) => (
          <AmountPadField
            key={c.id}
            label={fill(t.priceFor, { code: c.code })}
            value={v.prices[String(c.id)] ?? ''}
            onValue={(x) =>
              setV((p) => ({ ...p, prices: { ...p.prices, [String(c.id)]: x } }))
            }
            suffix={c.code}
            placeholder="—"
          />
        ))}
      </AppCard>

      <SectionTitle title={t.sectionStock} style={s.sectionGap} />
      <AppCard style={s.card}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={t.serviceSwitch}
          accessibilityState={{ checked: v.isService }}
          onPress={() => setV((p) => ({ ...p, isService: !p.isService }))}
          style={({ pressed }) => [s.switchRow, pressed && s.pressed]}
        >
          <View style={s.switchText}>
            <Text style={s.switchLabel}>{t.serviceSwitch}</Text>
            <Text style={s.switchHint}>{t.serviceHint}</Text>
          </View>
          <Switch
            value={v.isService}
            onValueChange={(x) => setV((p) => ({ ...p, isService: x }))}
            trackColor={{ true: colors.accent, false: colors.border }}
            thumbColor={v.isService ? colors.bg : colors.textSecondary}
          />
        </Pressable>
        {mode === 'create' && !v.isService ? (
          <>
            <AmountPadField
              label={t.openingQtyLabel}
              value={v.openingQty}
              onValue={(x) => setV((p) => ({ ...p, openingQty: x }))}
              hint={t.openingQtyHint}
            />
            {warehouseOptions.length > 0 ? (
              <SelectField
                label={t.openingWarehouseLabel}
                value={v.warehouseId}
                options={warehouseOptions}
                searchable={false}
                onSelect={(val) => setV((p) => ({ ...p, warehouseId: val }))}
              />
            ) : null}
          </>
        ) : null}
      </AppCard>

      <PrimaryButton label={t.saveProduct} onPress={save} loading={saving} style={s.saveBtn} />

      {/* ---- شيت فئة جديدة ---- */}
      <BottomSheet visible={catSheet} onClose={() => setCatSheet(false)} title={t.categorySheetTitle}>
        <View style={s.sheetBody}>
          <TextField
            label={t.categoryNameLabel}
            value={catName}
            onChangeText={setCatName}
            placeholder={t.categoryNamePlaceholder}
          />
          <SelectField
            label={t.parentCategoryLabel}
            value={catParent}
            placeholder={t.noParentCategory}
            options={topLevelCategoryOptions}
            searchable={false}
            onSelect={(val) => setCatParent(val)}
          />
          <PrimaryButton label={common.add} onPress={saveNewCategory} />
        </View>
      </BottomSheet>

      {/* ---- شيت وحدة جديدة ---- */}
      <BottomSheet visible={unitSheet} onClose={() => setUnitSheet(false)} title={t.unitSheetTitle}>
        <View style={s.sheetBody}>
          <TextField
            label={t.unitNameLabel}
            value={unitName}
            onChangeText={setUnitName}
            placeholder={t.unitNamePlaceholder}
          />
          <SelectField
            label={t.baseUnitLabel}
            value={unitBase}
            placeholder={t.noBaseUnit}
            options={baseUnitOptions}
            searchable={false}
            onSelect={(val) => setUnitBase(val)}
          />
          {unitBase !== null ? (
            <AmountPadField
              label={t.factorLabel}
              value={unitFactor}
              onValue={setUnitFactor}
              hint={t.factorHint}
            />
          ) : null}
          <PrimaryButton label={common.add} onPress={saveNewUnit} />
        </View>
      </BottomSheet>
    </>
  );
}

const s = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  sectionGap: { marginTop: spacing.lg },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  barcodeField: {
    flex: 1,
  },
  genBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  pricesHintWrap: {
    marginTop: -spacing.xs,
  },
  pricesHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    lineHeight: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
  },
  switchText: {
    flex: 1,
    gap: 2,
  },
  switchLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  switchHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    lineHeight: 16,
  },
  saveBtn: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: 0.85 },
});
