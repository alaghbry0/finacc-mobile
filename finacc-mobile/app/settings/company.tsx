import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import {
  AppCard,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SectionTitle,
  TextField,
} from '@/components';
import { common, settings as t } from '@/i18n/ar';
import { getDb } from '@/db/client';
import { logAudit } from '@/domain/audit';
import { useToastStore } from '@/store/toast';
import { dec, roundTo, money } from '@/utils/money';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface CompanyForm {
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  footerText: string;
  taxRate: string;
  taxNumber: string;
  baseCurrencyLabel: string;
}

/**
 * بيانات المنشأة (FR-13-02 جزء + FR-08-01): الاسم/الهاتف/واتساب/العنوان/
 * التذييل/الضريبة — العملة الأساس معطلة دائماً بعد الإعداد (شرح مكتوب).
 * الشعار: مؤجل لبناء EAS (ملاحظة ظاهرة) — يُطبع الاسم بخط بارز حالياً.
 */
export default function CompanySettingsScreen() {
  const showToast = useToastStore((s) => s.show);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CompanyForm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const rows = await db.all<{
        name: string; phone: string | null; whatsapp: string | null; address: string | null;
        footer_text: string | null; tax_rate: string | number; tax_number: string | null;
        currency_name: string; currency_code: string;
      }>(
        `SELECT c.name, c.phone, c.whatsapp, c.address, c.footer_text, c.tax_rate, c.tax_number,
                cur.name AS currency_name, cur.code AS currency_code
         FROM company c JOIN currency cur ON cur.id = c.currency_id LIMIT 1`,
      );
      const r = rows[0];
      if (r === undefined) {
        setForm(null);
        return;
      }
      setForm({
        name: String(r.name ?? ''),
        phone: r.phone ?? '',
        whatsapp: r.whatsapp ?? '',
        address: r.address ?? '',
        footerText: r.footer_text ?? '',
        taxRate: money(roundTo(r.tax_rate ?? 0, 2)),
        taxNumber: r.tax_number ?? '',
        baseCurrencyLabel: `${r.currency_name} (${r.currency_code})`,
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (form === null || saving) return;
    if (form.name.trim().length === 0) {
      showToast(t.companyNeedName);
      return;
    }
    setSaving(true);
    try {
      const db = await getDb();
      const taxRate = form.taxRate.trim() === '' ? '0' : money(roundTo(dec(form.taxRate), 2));
      if (dec(taxRate).lessThan(0) || dec(taxRate).greaterThan(100)) {
        showToast('نسبة الضريبة يجب أن تكون بين 0 و100');
        return;
      }
      await db.run(
        'UPDATE company SET name = ?, phone = ?, whatsapp = ?, address = ?, footer_text = ?, tax_rate = ?, tax_number = ?, updated_at = ?',
        [
          form.name.trim(),
          form.phone.trim().length > 0 ? form.phone.trim() : null,
          form.whatsapp.trim().length > 0 ? form.whatsapp.trim() : null,
          form.address.trim().length > 0 ? form.address.trim() : null,
          form.footerText.trim().length > 0 ? form.footerText.trim() : null,
          taxRate,
          form.taxNumber.trim().length > 0 ? form.taxNumber.trim() : null,
          new Date().toISOString(),
        ],
      );
      await logAudit('company_update', { entity: 'company', details: { name: form.name.trim() } });
      showToast(t.companySaved);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.companySaveFailed);
    } finally {
      setSaving(false);
    }
  }, [form, saving, showToast]);

  if (loading) {
    return (
      <Screen title={t.companyTitle} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton rows={4} />
      </Screen>
    );
  }

  if (form === null) {
    return (
      <Screen title={t.companyTitle} onBack={() => router.back()}>
        <Text style={s.empty}>{common.errorGeneral}</Text>
      </Screen>
    );
  }

  return (
    <Screen title={t.companyTitle} onBack={() => router.back()}>
      <AppCard>
        <TextField
          label={t.companyNameLabel}
          value={form.name}
          onChangeText={(v) => setForm({ ...form, name: v })}
          maxLength={120}
          required
        />
        <View style={s.row}>
          <View style={s.half}>
            <TextField
              label={t.companyPhoneLabel}
              value={form.phone}
              onChangeText={(v) => setForm({ ...form, phone: v })}
              keyboardType="phone-pad"
              maxLength={30}
            />
          </View>
          <View style={s.half}>
            <TextField
              label={t.companyWhatsappLabel}
              value={form.whatsapp}
              onChangeText={(v) => setForm({ ...form, whatsapp: v })}
              keyboardType="phone-pad"
              maxLength={30}
            />
          </View>
        </View>
        <TextField
          label={t.companyAddressLabel}
          value={form.address}
          onChangeText={(v) => setForm({ ...form, address: v })}
          maxLength={200}
          multiline
        />
        <TextField
          label={t.companyFooterLabel}
          value={form.footerText}
          onChangeText={(v) => setForm({ ...form, footerText: v })}
          hint={t.companyFooterHint}
          maxLength={200}
          multiline
        />
        <View style={s.row}>
          <View style={s.half}>
            <TextField
              label={t.companyTaxNumberLabel}
              value={form.taxNumber}
              onChangeText={(v) => setForm({ ...form, taxNumber: v })}
              maxLength={50}
            />
          </View>
          <View style={s.half}>
            <TextField
              label={t.companyTaxRateLabel}
              value={form.taxRate}
              onChangeText={(v: string) => setForm({ ...form, taxRate: v })}
              hint={t.companyTaxRateHint}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <PrimaryButton label={common.save} onPress={() => void save()} disabled={saving} />
      </AppCard>

      <SectionTitle title={t.baseCurrencyLabel} />
      <AppCard>
        <View style={s.lockedRow}>
          <Lock size={18} color={colors.muted} />
          <Text style={s.lockedValue}>{form.baseCurrencyLabel}</Text>
        </View>
        <Text style={s.lockedNote}>{t.baseCurrencyLocked}</Text>
        <Text style={s.logoNote}>{t.logoNote}</Text>
      </AppCard>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lockedValue: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
  },
  lockedNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  logoNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
});
