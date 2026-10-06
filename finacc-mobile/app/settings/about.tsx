import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, Database, Eraser, HardDrive, ShieldCheck } from 'lucide-react-native';
import {
  AppCard,
  ConfirmSheet,
  LoadingSkeleton,
  Screen,
  SectionTitle,
  StatTile,
} from '@/components';
import { common, settings as t } from '@/i18n/ar';
import { getDb } from '@/db/client';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/**
 * حول التطبيق (FR-13-07): الإصدار + إحصاءات حجم البيانات + فحص سلامة القاعدة
 * (PRAGMA integrity_check) + مسح بيانات المعاينة (بيئة الويب) بكلمة تأكيد.
 */

const APP_VERSION = '1.0.0';

type LoadState = 'loading' | 'ready' | 'error';

interface StatsRow {
  documents: number;
  products: number;
  txs: number;
  parties: number;
  dbSizeBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AboutScreen() {
  const showToast = useToastStore((s) => s.show);
  const [state, setState] = useState<LoadState>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [checking, setChecking] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setState('loading');
    setErrorDetail(null);
    try {
      const db = await getDb();
      const [docs, prods, txs, parties, pages, pageSize] = await Promise.all([
        // جدول موحّد doc_type (sale/purchase/sale_return/purchase_return) — status غير الملغاة/المسودات
        db.all<{ c: number }>(`SELECT count(*) AS c FROM invoice WHERE status = 'completed'`),
        db.all<{ c: number }>(`SELECT count(*) AS c FROM product WHERE is_archived = 0`),
        db.all<{ c: number }>(`SELECT count(*) AS c FROM cash_tx`),
        db.all<{ c: number }>(
          `SELECT (SELECT count(*) FROM customer) + (SELECT count(*) FROM supplier) AS c`,
        ),
        db.all<{ page_count: number }>(`PRAGMA page_count`),
        db.all<{ page_size: number }>(`PRAGMA page_size`),
      ]);
      setStats({
        documents: Number(docs[0]?.c ?? 0),
        products: Number(prods[0]?.c ?? 0),
        txs: Number(txs[0]?.c ?? 0),
        parties: Number(parties[0]?.c ?? 0),
        dbSizeBytes: Number(pages[0]?.page_count ?? 0) * Number(pageSize[0]?.page_size ?? 0),
      });
      setState('ready');
    } catch (e) {
      setErrorDetail(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runIntegrity = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      const db = await getDb();
      const rows = await db.all<{ integrity_check: string }>('PRAGMA integrity_check');
      const result = String(rows[0]?.integrity_check ?? '');
      if (result === 'ok') {
        showToast(t.integrityOk);
      } else {
        showToast(`${t.integrityFailed}: ${result}`);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setChecking(false);
    }
  }, [showToast]);

  const doWipe = useCallback(async (): Promise<void> => {
    setWiping(true);
    try {
      // ويب: حذف قاعدة IndexedDB المحفوظة بالكامل ثم إعادة التحميل للإعداد الأولي
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('finacc');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error(req.error?.message ?? 'deleteDatabase failed'));
        // المتصفح قد يعلّق الحذف إن كانت القاعدة مفتوحة — نتابع بعد مهلة قصيرة
        setTimeout(() => resolve(), 1500);
      });
      showToast(t.wipeDone);
      setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (e) {
      setWiping(false);
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    }
  }, [showToast]);

  return (
    <Screen title={t.aboutTitle} onBack={() => router.back()} scroll={false}>
      {wiping ? (
        <View style={s.center}>
          <Text style={s.wiping}>{t.wipeDone}</Text>
        </View>
      ) : state === 'loading' ? (
        <LoadingSkeleton variant="list" rows={5} />
      ) : state === 'error' || stats === null ? (
        <AppCard>
          <Text style={s.errorText}>{errorDetail ?? common.errorGeneral}</Text>
        </AppCard>
      ) : (
        <View style={s.body}>
          {/* ===== الإصدار ===== */}
          <AppCard style={s.versionCard}>
            <View style={s.versionRow}>
              <HardDrive size={22} color={colors.accent} />
              <View style={s.versionCol}>
                <Text style={s.versionName}>{common.appName}</Text>
                <Text style={s.versionMeta}>
                  {t.aboutVersionLabel} {APP_VERSION} · {common.tagline}
                </Text>
              </View>
            </View>
          </AppCard>

          {/* ===== حجم البيانات ===== */}
          <SectionTitle title={t.aboutSectionStats} />
          <View style={s.tilesGrid}>
            <StatTile
              label={t.aboutStatDbSize}
              value={formatBytes(stats.dbSizeBytes)}
              icon={<Database size={18} color={colors.accent} />}
              style={s.tile}
            />
            <StatTile
              label={t.aboutStatInvoices}
              value={String(stats.documents)}
              icon={<CheckCircle2 size={18} color={colors.success} />}
              style={s.tile}
            />
            <StatTile
              label={t.aboutStatProducts}
              value={String(stats.products)}
              style={s.tile}
            />
            <StatTile label={t.aboutStatTxs} value={String(stats.txs)} style={s.tile} />
            <StatTile label={t.aboutStatParties} value={String(stats.parties)} style={s.tile} />
          </View>

          {/* ===== فحص السلامة ===== */}
          <SectionTitle title={t.aboutSectionHealth} />
          <AppCard>
            <Pressable accessibilityRole="button" accessibilityLabel={t.integrityBtn} onPress={() => void runIntegrity()} disabled={checking} style={s.healthRow}>
              <ShieldCheck size={20} color={colors.success} />
              <Text style={s.healthText}>{t.integrityBtn}</Text>
            </Pressable>
            <Text style={s.healthHint}>{checking ? t.integrityRunning : t.integrityOk}</Text>
          </AppCard>

          {/* ===== مسح بيانات المعاينة ===== */}
          <SectionTitle title={t.aboutSectionDanger} />
          <AppCard style={s.dangerCard}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.wipeBtn} onPress={() => setWipeOpen(true)} style={s.healthRow}>
              <Eraser size={20} color={colors.error} />
              <Text style={s.dangerText}>{t.wipeBtn}</Text>
            </Pressable>
            <Text style={s.healthHint}>{t.wipeWebHint}</Text>
          </AppCard>
        </View>
      )}

      <ConfirmSheet
        visible={wipeOpen}
        title={t.wipeTitle}
        message={t.wipeWarning}
        requireText={t.wipeWord}
        busy={wiping}
        onClose={() => setWipeOpen(false)}
        onConfirm={() => void doWipe()}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { gap: 0, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  wiping: { fontFamily: fonts.bodyMedium, fontSize: fontSizes.body, color: colors.textPrimary },
  versionCard: { paddingVertical: spacing.md },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  versionCol: { flex: 1, gap: 2 },
  versionName: { fontFamily: fonts.bodyBold, fontSize: fontSizes.title, color: colors.textPrimary },
  versionMeta: { fontFamily: fonts.body, fontSize: fontSizes.caption, color: colors.textSecondary },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: { flexBasis: '47%', flexGrow: 1 },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  healthText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: fontSizes.body, color: colors.textPrimary },
  healthHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  dangerCard: { borderWidth: 1.5, borderColor: colors.error, borderRadius: radii.md },
  dangerText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: fontSizes.body, color: colors.error },
  errorText: { fontFamily: fonts.body, fontSize: fontSizes.body, color: colors.error },
});
