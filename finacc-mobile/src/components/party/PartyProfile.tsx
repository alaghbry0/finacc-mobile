import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Clock3, MapPin, MessageCircle, Phone, StickyNote } from 'lucide-react-native';
import {
  AmountText,
  AppCard,
  ConfirmSheet,
  DangerButton,
  EmptyState,
  IconButton,
  LoadingSkeleton,
  SecondaryButton,
} from '@/components';
import type { PartyKind } from './PartyForm';
import { archiveCustomer, archiveSupplier, customerBalances, getCustomer, getSupplier, supplierBalances, type CustomerRow, type PartyBalance, type SupplierRow } from '@/domain/parties';
import { listAllCurrencies } from '@/domain/currency';
import { common, parties as partiesAr } from '@/i18n/ar';
import { useToastStore } from '@/store/toast';
import { openURL, telURL, whatsappURL } from '@/utils/open-url';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface PartyProfileProps {
  kind: PartyKind;
  id: number;
  /** الانتقال لشاشة التعديل (مسار مختلف للعميل والمورّد). */
  onEdit: () => void;
  /** بعد الأرشفة الناجحة (رجوع للقائمة عادةً). */
  onArchived: () => void;
}

interface CurrencyMeta {
  code: string;
  decimals: number;
  isBase: boolean;
}

/**
 * PartyProfile — ملف الطرف الموحّد (عميل/مورّد):
 * رأس بأفاتار وأزرار اتصال/واتساب + بطاقات الرصيد لكل عملة على حدة (قرار 8)
 * + حد الائتمان (عميل) + بيانات + الرصيد الافتتاحي + تعديل/أرشفة (FR-03-09)
 * + بطاقة «كشف الحساب — الموجة القادمة» (FR-03-04 مؤجلة).
 */
export function PartyProfile({ kind, id, onEdit, onArchived }: PartyProfileProps) {
  const showToast = useToastStore((s) => s.show);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [balances, setBalances] = useState<PartyBalance[]>([]);
  const [currencyMeta, setCurrencyMeta] = useState<Map<number, CurrencyMeta>>(new Map());
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const isCustomer = kind === 'customer';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [party, partyBalances, currencies] = await Promise.all([
        isCustomer ? getCustomer(id) : getSupplier(id),
        isCustomer ? customerBalances(id) : supplierBalances(id),
        listAllCurrencies(),
      ]);
      if (party === null) {
        setError('not-found');
        return;
      }
      if (isCustomer) setCustomer(party as CustomerRow);
      else setSupplier(party as SupplierRow);
      setBalances(partyBalances);
      setCurrencyMeta(
        new Map(
          currencies.map((c) => [
            Number(c.id),
            { code: c.code, decimals: Number(c.decimals), isBase: Number(c.is_base) === 1 },
          ]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id, isCustomer]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = customer?.name ?? supplier?.name ?? '';
  const phone = customer?.phone ?? supplier?.phone ?? null;
  const whatsappNumber = customer?.whatsapp?.length ? customer.whatsapp : phone;
  const notes = customer?.notes ?? supplier?.notes ?? null;
  const address = customer?.address ?? supplier?.address ?? null;
  const opening = customer ?? supplier;
  const openingMeta =
    opening !== null && opening.openingCurrencyId !== null ? currencyMeta.get(opening.openingCurrencyId) : undefined;
  const baseMeta = [...currencyMeta.values()].find((m) => m.isBase);

  const call = async () => {
    if (phone === null) return;
    const ok = await openURL(telURL(phone));
    if (!ok) showToast(common.errorGeneral);
  };

  const openWhatsApp = async () => {
    if (whatsappNumber === null || whatsappNumber.length === 0) return;
    const ok = await openURL(whatsappURL(whatsappNumber));
    if (!ok) showToast(common.errorGeneral);
  };

  const doArchive = async () => {
    setArchiving(true);
    try {
      if (isCustomer) await archiveCustomer(id);
      else await archiveSupplier(id);
      setConfirmArchive(false);
      showToast(partiesAr.archivedToast);
      onArchived();
    } catch (e) {
      setConfirmArchive(false);
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setArchiving(false);
    }
  };

  if (loading) {
    return (
      <View style={s.wrap}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="list" rows={3} />
      </View>
    );
  }

  if (error !== null) {
    return (
      <EmptyState
        title={error === 'not-found' ? partiesAr.noBalancesTitle : common.errorTitle}
        message={error === 'not-found' ? '' : error}
      />
    );
  }

  return (
    <View style={s.wrap}>
      {/* الرأس: أفاتار + الاسم + الهاتف + اتصال/واتساب */}
      <AppCard>
        <View style={s.headRow}>
          <View style={s.avatar}>
            <Text style={s.avatarLetter}>{name.trim().charAt(0)}</Text>
          </View>
          <View style={s.headText}>
            <Text style={s.name}>{name}</Text>
            <Text style={s.phone}>{phone ?? partiesAr.noPhone}</Text>
          </View>
          <View style={s.headActions}>
            <IconButton
              icon={<Phone size={22} color={colors.accent} />}
              onPress={() => void call()}
              accessibilityLabel={partiesAr.call}
              disabled={phone === null || phone.length === 0}
              color="accent"
            />
            <IconButton
              icon={<MessageCircle size={22} color={colors.success} />}
              onPress={() => void openWhatsApp()}
              accessibilityLabel={partiesAr.whatsappCall}
              disabled={whatsappNumber === null || whatsappNumber.length === 0}
            />
          </View>
        </View>
        {customer !== null && customer.area !== null && customer.area.length > 0 ? (
          <View style={s.metaRow}>
            <MapPin size={15} color={colors.muted} />
            <Text style={s.metaText}>{customer.area}</Text>
          </View>
        ) : null}
      </AppCard>

      {/* بطاقات الرصيد لكل عملة (قرار 8) */}
      <AppCard>
        <Text style={s.sectionTitle}>{partiesAr.balancesSection}</Text>
        {balances.length === 0 ? (
          <EmptyState title={partiesAr.noBalancesTitle} message={partiesAr.noBalancesMessage} />
        ) : (
          <View style={s.balancesCol}>
            {balances.map((b) => {
              const meta = currencyMeta.get(b.currencyId);
              const value = Number(b.balance);
              const isDebit = value > 0;
              const isCredit = value < 0;
              return (
                <View key={b.currencyId} style={s.balanceRow}>
                  <Text style={s.currencyCode}>{b.code}</Text>
                  <Text
                    style={[
                      s.balanceTag,
                      isDebit && s.tagDebit,
                      isCredit && s.tagCredit,
                      !isDebit && !isCredit && s.tagSettled,
                    ]}
                  >
                    {isDebit ? (isCustomer ? partiesAr.debit : partiesAr.owedToSupplier) : isCredit ? partiesAr.credit : partiesAr.settled}
                  </Text>
                  <AmountText
                    value={b.balance}
                    mark="none"
                    decimals={meta?.decimals ?? 2}
                    suffix={b.code}
                    size={fontSizes.title}
                    color={isDebit ? colors.warning : isCredit ? colors.success : colors.textPrimary}
                  />
                </View>
              );
            })}
          </View>
        )}
      </AppCard>

      {/* حد الائتمان (عميل فقط — FR-03-01) */}
      {customer !== null ? (
        <AppCard>
          <View style={s.limitRow}>
            <Text style={s.limitLabel}>{partiesAr.creditLimit}</Text>
            {customer.creditLimit === null ? (
              <Text style={s.limitValue}>{partiesAr.creditLimitNoLimitLabel}</Text>
            ) : customer.creditLimit === '0' ? (
              <Text style={[s.limitValue, { color: colors.error }]}>{partiesAr.creditLimitZeroLabel}</Text>
            ) : (
              <AmountText
                value={customer.creditLimit}
                mark="none"
                decimals={baseMeta?.decimals ?? 2}
                suffix={baseMeta?.code}
                size={fontSizes.body}
              />
            )}
          </View>
        </AppCard>
      ) : null}

      {/* البيانات + الرصيد الافتتاحي */}
      <AppCard>
        <Text style={s.sectionTitle}>{partiesAr.infoSection}</Text>
        {address !== null && address.length > 0 ? (
          <View style={s.metaRow}>
            <MapPin size={15} color={colors.muted} />
            <Text style={s.metaText}>{address}</Text>
          </View>
        ) : null}
        {opening !== null && opening.openingBalance !== '0' ? (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>{partiesAr.openingSection}</Text>
            <Text style={s.metaText}>
              {`${opening.openingBalance} ${openingMeta?.code ?? ''}`}
              {opening.openingRate !== null && opening.openingRate !== '1' ? ` × ${opening.openingRate}` : ''}
              {opening.openingDate !== null ? ` — ${opening.openingDate}` : ''}
            </Text>
          </View>
        ) : null}
        {notes !== null && notes.length > 0 ? (
          <View style={s.metaRow}>
            <StickyNote size={15} color={colors.muted} />
            <Text style={s.metaText}>{notes}</Text>
          </View>
        ) : null}
        {opening?.createdAt !== null && opening?.createdAt !== undefined ? (
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>{partiesAr.createdAt}</Text>
            <Text style={s.metaText}>{opening.createdAt.slice(0, 10)}</Text>
          </View>
        ) : null}
      </AppCard>

      {/* كشف الحساب — الموجة القادمة (FR-03-04 مؤجلة) */}
      <AppCard style={s.softCard}>
        <View style={s.softRow}>
          <Clock3 size={20} color={colors.muted} />
          <View style={s.softTextWrap}>
            <Text style={s.softTitle}>{partiesAr.statementSoonTitle}</Text>
            <Text style={s.softMessage}>{partiesAr.statementSoonMessage}</Text>
          </View>
        </View>
      </AppCard>

      {/* أزرار التعديل والأرشفة */}
      <View style={s.actionsRow}>
        <SecondaryButton label={common.edit} onPress={onEdit} style={s.actionBtn} />
        <DangerButton label={partiesAr.archive} onPress={() => setConfirmArchive(true)} style={s.actionBtn} />
      </View>

      <ConfirmSheet
        visible={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void doArchive()}
        title={partiesAr.archiveTitle}
        message={partiesAr.archiveMessage}
        confirmLabel={partiesAr.archive}
        busy={archiving}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.lg, paddingBottom: spacing.xl },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: fonts.bodyBold,
    fontSize: 24,
    color: colors.accent,
    includeFontPadding: false,
  },
  headText: { flex: 1, gap: 2 },
  name: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
  },
  phone: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  headActions: { flexDirection: 'row', gap: spacing.sm },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  balancesCol: { gap: spacing.sm },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  currencyCode: {
    fontFamily: fonts.numeric,
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    minWidth: 44,
  },
  balanceTag: {
    fontSize: fontSizes.micro,
    fontFamily: fonts.bodyMedium,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  tagDebit: {
    color: colors.warning,
    backgroundColor: colors.extra.warningSoft,
  },
  tagCredit: {
    color: colors.success,
    backgroundColor: colors.extra.successSoft,
  },
  tagSettled: {
    color: colors.textSecondary,
    backgroundColor: colors.extra.mutedSoft,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  limitLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  limitValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  metaLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.muted,
  },
  metaText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  softCard: { backgroundColor: 'rgba(30, 41, 59, 0.55)' },
  softRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  softTextWrap: { flex: 1, gap: 2 },
  softTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  softMessage: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    lineHeight: 17,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionBtn: { flex: 1 },
});
