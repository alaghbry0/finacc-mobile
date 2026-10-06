import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { AlertTriangle, ChevronDown, Pencil, Plus } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  BottomSheet,
  EmptyState,
  LoadingSkeleton,
  NumberPad,
  PrimaryButton,
  Screen,
  SelectField,
  TextField,
  type SelectOption,
} from '@/components';
import {
  addCurrency,
  rateHistory,
  setCurrencyActive,
  setDailyRate,
  listAllCurrencies,
  type CurrencyRow,
  type RateHistoryRow,
} from '@/domain/currency';
import { common, currency as currencyAr } from '@/i18n/ar';
import { useToastStore } from '@/store/toast';
import { todayISO } from '@/utils/format';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface CurrencyCard {
  row: CurrencyRow;
  history: RateHistoryRow[];
  /** سعر اليوم إن أُدخل (وإلا null — شارة حمراء). */
  todayRate: string | null;
}

const DECIMAL_OPTIONS: SelectOption[] = [0, 1, 2, 3, 4, 5, 6].map((n) => ({
  value: String(n),
  label: `${n}`,
}));

/**
 * شاشة العملات وأسعار الصرف (الوحدة 08):
 * قائمة العملات (الأساس بشارة «أساسية» وSwitch معطّل) + سعر اليوم لكل عملة غير
 * أساسية (تعديل عبر NumberPad → setDailyRate) + سجل آخر 14 سعراً + شارة حمراء
 * عند نقص سعر اليوم + إضافة عملة (BottomSheet).
 */
export default function CurrenciesSettingsScreen() {
  const showToast = useToastStore((s) => s.show);
  const today = useMemo(() => todayISO(), []);
  const [cards, setCards] = useState<CurrencyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // شيت إضافة عملة
  const [addOpen, setAddOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newDecimals, setNewDecimals] = useState('2');
  const [adding, setAdding] = useState(false);

  // شيت تعديل سعر اليوم
  const [editing, setEditing] = useState<CurrencyRow | null>(null);
  const [rateDraft, setRateDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await listAllCurrencies();
      const loaded = await Promise.all(
        all.map(async (row) => {
          const history = Number(row.is_base) === 1 ? [] : await rateHistory(Number(row.id), 14);
          const todayRate = history[0] !== undefined && history[0].rateDate === today ? history[0].rate : null;
          return { row, history, todayRate } satisfies CurrencyCard;
        }),
      );
      setCards(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  const missingToday = cards.filter((c) => Number(c.row.is_base) !== 1 && Number(c.row.is_active) === 1 && c.todayRate === null);
  const activeCount = cards.filter((c) => Number(c.row.is_active) === 1).length;

  const toggleActive = async (card: CurrencyCard, next: boolean) => {
    try {
      await setCurrencyActive(Number(card.row.id), next);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : currencyAr.baseNoDisable);
      await load();
    }
  };

  const submitAdd = async () => {
    setAdding(true);
    try {
      await addCurrency({ code: newCode.trim(), name: newName.trim(), decimals: Number(newDecimals) });
      showToast(currencyAr.currencyAddedToast);
      setAddOpen(false);
      setNewCode('');
      setNewName('');
      setNewDecimals('2');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const submitRate = async () => {
    if (editing === null || rateDraft.length === 0) return;
    try {
      await setDailyRate(Number(editing.id), today, rateDraft);
      showToast(currencyAr.rateSavedToast);
      setEditing(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen
      title={currencyAr.title}
      subtitle={currencyAr.subtitle}
      onBack={() => router.back()}
      actions={[
        {
          icon: <Plus size={24} color={colors.accent} />,
          label: currencyAr.addCurrency,
          onPress: () => setAddOpen(true),
        },
      ]}
    >
      {/* تنبيه العملات بلا سعر اليوم (FR-08-04/09) */}
      {missingToday.length > 0 ? (
        <View style={s.missingBanner}>
          <AlertTriangle size={18} color={colors.warning} />
          <Text style={s.missingText}>
            {`${currencyAr.missingRatesBanner}: ${missingToday.map((c) => c.row.code).join('، ')}`}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <LoadingSkeleton variant="card" />
      ) : error !== null ? (
        <EmptyState title={common.errorTitle} message={error} actionLabel={common.retry} onAction={() => void load()} />
      ) : cards.length === 0 ? (
        <EmptyState
          title={currencyAr.title}
          message={common.emptyList}
          actionLabel={currencyAr.addCurrency}
          onAction={() => setAddOpen(true)}
        />
      ) : (
        cards.map((card) => {
          const isBase = Number(card.row.is_base) === 1;
          const isActive = Number(card.row.is_active) === 1;
          const showRates = !isBase;
          return (
            <AppCard key={card.row.id} style={!isActive ? s.inactiveCard : undefined}>
              {/* رأس العملة: الرمز + الاسم + الشارات + Switch */}
              <View style={s.curHead}>
                <View style={s.curHeadText}>
                  <View style={s.codeRow}>
                    <Text style={[s.code, !isActive && s.codeInactive]}>{card.row.code}</Text>
                    {isBase ? <Text style={s.baseBadge}>{currencyAr.baseBadge}</Text> : null}
                    {!isActive ? <Text style={s.inactiveBadge}>{currencyAr.inactiveBadge}</Text> : null}
                  </View>
                  <Text style={s.curName}>{card.row.name}</Text>
                </View>
                <Switch
                  accessibilityLabel={`${currencyAr.activeLabel} ${card.row.code}`}
                  value={isActive}
                  disabled={isBase}
                  onValueChange={(v) => void toggleActive(card, v)}
                  trackColor={{ false: colors.border, true: colors.success }}
                  thumbColor={colors.textPrimary}
                />
              </View>

              {showRates ? (
                <View style={s.ratesWrap}>
                  {/* سعر اليوم — صف التعديل */}
                  <View style={s.todayRow}>
                    <View style={s.todayTextWrap}>
                      <Text style={s.todayLabel}>{currencyAr.todayRate}</Text>
                      {card.todayRate !== null ? (
                        <View style={s.todayValueRow}>
                          <Text style={s.todayDate}>{today}</Text>
                          <AmountText value={card.todayRate} mark="none" decimals={4} size={fontSizes.body} />
                        </View>
                      ) : (
                        <Text style={s.missingBadge}>{currencyAr.noRateToday}</Text>
                      )}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${currencyAr.editRate} ${card.row.code}`}
                      onPress={() => {
                        setEditing(card.row);
                        setRateDraft(card.todayRate ?? '');
                      }}
                      style={({ pressed }) => [s.editBtn, pressed && s.pressed, card.todayRate === null && s.editBtnMissing]}
                    >
                      <Pencil size={18} color={card.todayRate === null ? colors.error : colors.accent} />
                      <Text style={[s.editBtnText, card.todayRate === null && s.editBtnTextMissing]}>
                        {card.todayRate === null ? currencyAr.enterRate : currencyAr.editRate}
                      </Text>
                    </Pressable>
                  </View>

                  {/* سجل آخر الأسعار */}
                  {card.history.length > 0 ? (
                    <View style={s.historyWrap}>
                      <View style={s.historyHead}>
                        <ChevronDown size={14} color={colors.muted} />
                        <Text style={s.historyTitle}>{currencyAr.historySection}</Text>
                        <Text style={s.historyCount}>{`${card.history.length}`}</Text>
                      </View>
                      {card.history.map((h) => (
                        <View key={h.rateDate} style={s.historyRow}>
                          <Text style={h.rateDate === today ? s.historyDateToday : s.historyDate}>{h.rateDate}</Text>
                          <AmountText value={h.rate} mark="none" decimals={4} size={fontSizes.caption} />
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={s.historyEmpty}>{currencyAr.historyEmpty}</Text>
                  )}
                </View>
              ) : null}
            </AppCard>
          );
        })
      )}

      <Text style={s.footNote}>{`${currencyAr.activeLabel}: ${activeCount}`}</Text>

      {/* شيت إضافة عملة (FR-08-02) */}
      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title={currencyAr.addCurrency}>
        <View style={s.sheetBody}>
          <TextField
            label={currencyAr.addCurrencyCode}
            value={newCode}
            onChangeText={(t) => setNewCode(t.toUpperCase())}
            hint={currencyAr.addCurrencyCodeHint}
            required
            maxLength={8}
          />
          <TextField
            label={currencyAr.addCurrencyName}
            value={newName}
            onChangeText={setNewName}
            placeholder={currencyAr.addCurrencyNamePlaceholder}
            required
          />
          <SelectField
            label={currencyAr.addCurrencyDecimals}
            value={newDecimals}
            options={DECIMAL_OPTIONS}
            onSelect={setNewDecimals}
            hint={currencyAr.addCurrencyDecimalsHint}
            searchable={false}
          />
          <PrimaryButton
            label={common.save}
            onPress={() => void submitAdd()}
            loading={adding}
            disabled={adding || newCode.trim().length < 2 || newName.trim().length === 0}
          />
        </View>
      </BottomSheet>

      {/* شيت تعديل سعر اليوم — NumberPad (FR-08-03) */}
      <BottomSheet visible={editing !== null} onClose={() => setEditing(null)} title={editing !== null ? `${currencyAr.enterRate} — ${editing.code}` : undefined}>
        {editing !== null ? (
          <View style={s.sheetBody}>
            <Text style={s.rateHint}>{`${currencyAr.rateSuffix} (${editing.code} → ${cards.find((c) => Number(c.row.is_base) === 1)?.row.code ?? ''})`}</Text>
            <NumberPad value={rateDraft} onValue={setRateDraft} allowDecimal maxlength={12} />
            <PrimaryButton label={common.save} onPress={() => void submitRate()} disabled={rateDraft.length === 0} />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.extra.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.4)',
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  missingText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.warning,
    lineHeight: 19,
  },
  inactiveCard: { opacity: 0.65 },
  curHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  curHeadText: { flex: 1, gap: 2 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  code: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  codeInactive: { color: colors.muted },
  baseBadge: {
    fontSize: fontSizes.micro,
    fontFamily: fonts.bodyBold,
    color: colors.accent,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.4)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  inactiveBadge: {
    fontSize: fontSizes.micro,
    fontFamily: fonts.bodyMedium,
    color: colors.muted,
    backgroundColor: colors.extra.mutedSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  curName: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  ratesWrap: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  todayTextWrap: { flex: 1, gap: 2 },
  todayLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  todayValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  todayDate: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.muted,
  },
  missingBadge: {
    alignSelf: 'flex-start',
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.micro,
    color: colors.error,
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.4)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  editBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.4)',
  },
  editBtnMissing: {
    backgroundColor: colors.extra.errorSoft,
    borderColor: 'rgba(248, 113, 113, 0.45)',
  },
  editBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  editBtnTextMissing: { color: colors.error },
  historyWrap: {
    gap: 2,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  historyTitle: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  historyCount: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.5)',
  },
  historyDate: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  historyDateToday: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  historyEmpty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  footNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  rateHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pressed: { opacity: 0.85 },
});
