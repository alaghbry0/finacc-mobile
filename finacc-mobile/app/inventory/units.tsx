import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Archive, Ruler } from 'lucide-react-native';
import {
  BottomSheet,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SelectField,
  TextField,
} from '@/components';
import { common, fill, inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import {
  archiveUnit,
  listUnits,
  upsertUnit,
  type UnitRow,
} from '@/domain/inventory';
import { useToastStore } from '@/store/toast';
import { AmountPadField } from '@/screens/inventory/AmountPadSheet';

/**
 * إدارة وحدات القياس (FR-01-05): قائمة + إضافة/تعديل BottomSheet
 * (اسم + وحدة أساس + معامل تحويل عبر NumberPad) + أرشفة.
 */
export default function UnitsScreen() {
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToastStore((s) => s.show);

  // شيت الإضافة/التعديل
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [baseId, setBaseId] = useState<string | null>(null);
  const [factor, setFactor] = useState('');

  // شيت الأرشفة
  const [archiveTarget, setArchiveTarget] = useState<UnitRow | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setUnits(await listUnits());
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'تعذر تحميل الوحدات');
      setUnits([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openAdd = () => {
    setEditId(null);
    setName('');
    setBaseId(null);
    setFactor('');
    setSheetOpen(true);
  };

  const openEdit = (u: UnitRow) => {
    setEditId(u.id);
    setName(u.name);
    setBaseId(u.baseUnitId !== null ? String(u.baseUnitId) : null);
    setFactor(u.factor === '1' ? '' : u.factor);
    setSheetOpen(true);
  };

  const save = async () => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      await upsertUnit(
        editId,
        name.trim(),
        baseId !== null ? Number(baseId) : undefined,
        factor.trim() !== '' ? factor.trim() : undefined,
      );
      setSheetOpen(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const doArchive = async () => {
    if (archiveTarget === null) return;
    setBusy(true);
    try {
      await archiveUnit(archiveTarget.id);
      setArchiveTarget(null);
      toast(t.unitArchivedToast);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const baseOptions = (units ?? [])
    .filter((u) => u.baseUnitId === null)
    .map((u) => ({ value: String(u.id), label: u.name }));

  const nameOf = (id: number | null): string =>
    id === null ? '' : (units ?? []).find((u) => u.id === id)?.name ?? '';

  return (
    <Screen
      title={t.unitsTitle}
      onBack={() => router.back()}
      actions={[
        {
          icon: <Text style={s.plus}>+</Text>,
          label: t.addUnit,
          onPress: openAdd,
        },
      ]}
    >
      {failed !== null ? (
        <ErrorState message={failed} onRetry={load} />
      ) : units === null ? (
        <LoadingSkeleton variant="list" rows={4} />
      ) : units.length === 0 ? (
        <EmptyState
          icon={<Ruler size={40} color={colors.accent} />}
          title={t.unitsEmpty}
          actionLabel={t.addUnit}
          onAction={openAdd}
        />
      ) : (
        <View>
          {units.map((u, i) => (
            <ListRow
              key={u.id}
              title={u.name}
              subtitle={
                u.baseUnitId !== null
                  ? fill(t.factorDisplay, { name: u.name, factor: u.factor, base: nameOf(u.baseUnitId) })
                  : t.baseUnitNone
              }
              leading={
                <View style={s.icon}>
                  <Ruler size={18} color={colors.accent} />
                </View>
              }
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={common.delete}
                  onPress={() => setArchiveTarget(u)}
                  style={({ pressed }) => [s.miniBtn, pressed && s.pressed]}
                  hitSlop={4}
                >
                  <Archive size={18} color={colors.error} />
                </Pressable>
              }
              onPress={() => openEdit(u)}
              last={i === units.length - 1}
            />
          ))}
        </View>
      )}

      {/* شيت الإضافة/التعديل */}
      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editId !== null ? t.editUnit : t.unitSheetTitle}
      >
        <View style={s.sheetBody}>
          <TextField
            label={t.unitNameLabel}
            value={name}
            onChangeText={setName}
            placeholder={t.unitNamePlaceholder}
          />
          <SelectField
            label={t.baseUnitLabel}
            value={baseId}
            placeholder={t.noBaseUnit}
            options={baseOptions}
            searchable={false}
            onSelect={setBaseId}
          />
          {baseId !== null ? (
            <AmountPadField
              label={t.factorLabel}
              value={factor}
              onValue={setFactor}
              hint={t.factorHint}
            />
          ) : null}
          <PrimaryButton label={common.save} onPress={save} loading={busy} />
        </View>
      </BottomSheet>

      {/* تأكيد الأرشفة */}
      <ConfirmSheet
        visible={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={doArchive}
        title={t.archiveCategoryTitle}
        message={fill(t.archiveCategoryMessage, { name: archiveTarget?.name ?? '' })}
        busy={busy}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.accent,
    includeFontPadding: false,
    lineHeight: 26,
  },
  miniBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: 0.85 },
});
