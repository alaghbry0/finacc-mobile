import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, SecondaryButton } from '@/components';
import { getDb } from '@/db/client';
import { useToastStore } from '@/store/toast';
import { common, cash as t, printing as pr } from '@/i18n/ar';
import type { CashTxRow } from '@/domain/cash';
import { printVoucher } from '@/services/doc-print';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface VoucherSheetProps {
  visible: boolean;
  onClose: () => void;
  tx: CashTxRow | null;
  voucherNo: string;
}

/** اسم المنشأة لرأس السند (قراءة عرض فقط). */
function useCompanyName(): string {
  const [name, setName] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const db = await getDb();
        const rows = await db.all<{ name: string }>('SELECT name FROM company LIMIT 1');
        if (alive && rows.length > 0) setName(rows[0].name);
      } catch {
        /* الرأس يبقى بلا اسم — ليس فادحاً */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return name;
}

/**
 * معاينة السند المرقّم (FR-04-10) + طباعته الفعلية (الوحدة 10 — الموجة 6-b):
 * قالب موحّد فوق cash_tx — رقم كبير RVT/PMT + التاريخ + الطرف + المبلغ + سطر التوقيع،
 * وزر «إرسال للطابعة» يفتح voucherHtml عبر printHtml (الرقم مستهلك مسبقاً من consumeVoucherNo).
 */
export function VoucherSheet({ visible, onClose, tx, voucherNo }: VoucherSheetProps) {
  const companyName = useCompanyName();
  const toast = useToastStore((st) => st.show);
  const [printing, setPrinting] = useState(false);
  if (tx === null) return null;

  const isReceipt = tx.txType === 'receipt';
  const partyName =
    tx.customerName ?? tx.supplierName ?? tx.expenseCategoryName ?? tx.toCashboxName ?? '—';

  const doPrint = async (): Promise<void> => {
    if (printing) return;
    setPrinting(true);
    try {
      await printVoucher(tx, voucherNo);
    } catch (e) {
      toast(e instanceof Error ? e.message : pr.voucherPrintFailed, { duration: 7000 });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={isReceipt ? t.voucherReceipt : t.voucherPayment}>
      <View style={s.wrap}>
        <View style={s.paper}>
          <Text style={s.company}>{companyName.length > 0 ? companyName : common.appName}</Text>
          <Text style={s.docTitle}>{isReceipt ? t.voucherReceipt : t.voucherPayment}</Text>

          <View style={s.divider} />

          <Text style={s.noLabel}>{t.voucherNoLabel}</Text>
          <Text style={s.voucherNo} numberOfLines={1} adjustsFontSizeToFit>
            {voucherNo}
          </Text>

          <View style={s.row}>
            <Text style={s.rowLabel}>{t.fieldDate}</Text>
            <Text style={s.rowValue}>{common.formatDate(tx.txDate)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>{t.fieldParty}</Text>
            <Text style={s.rowValue} numberOfLines={1}>
              {partyName}
            </Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>{t.fieldCashbox}</Text>
            <Text style={s.rowValue} numberOfLines={1}>
              {tx.cashboxName ?? '—'}
            </Text>
          </View>
          {tx.description !== null && tx.description.length > 0 ? (
            <View style={s.row}>
              <Text style={s.rowLabel}>{t.fieldDesc}</Text>
              <Text style={s.rowValue} numberOfLines={2}>
                {tx.description}
              </Text>
            </View>
          ) : null}

          <View style={s.amountWrap}>
            <Text style={s.amountLabel}>{t.voucherAmount}</Text>
            <Text style={s.amount}>
              {tx.amount} <Text style={s.amountCode}>{tx.currencyCode}</Text>
            </Text>
          </View>

          <View style={s.signatureRow}>
            <View style={s.signatureBox}>
              <Text style={s.rowValue}>{t.voucherSignature}</Text>
            </View>
          </View>

          <Text style={s.note}>{t.voucherNote}</Text>
        </View>

        <SecondaryButton
          label={printing ? pr.printBusy : t.sendToPrinter}
          onPress={() => void doPrint()}
          disabled={printing}
        />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  paper: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  company: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  docTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.accent,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  noLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  voucherNo: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    includeFontPadding: false,
    direction: 'ltr',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 30,
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  rowValue: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  amountWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  amountLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  amount: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.display,
    fontWeight: '700',
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  amountCode: {
    fontSize: fontSizes.title,
    color: colors.textSecondary,
    fontFamily: fonts.bodyMedium,
  },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
  },
  signatureBox: {
    minWidth: 140,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  note: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
