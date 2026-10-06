import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getDb } from '@/db/client';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/**
 * شاشة تحقق Task 1 (تُستبدل لاحقاً):
 * تثبت أن sql.js + IndexedDB persistence + الهجرات تعمل داخل التصدير الثابت،
 * وأن expo-sqlite سيحمل نفس المخطط على الجهاز.
 */

interface DbStats {
  tables: number;
  migration: number | null;
  currencies: number;
  companies: number;
}

export default function VerifyScreen() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const db = await getDb();
      const tables = await db.all<{ c: number }>(
        "SELECT count(*) AS c FROM sqlite_master WHERE type='table'",
      );
      const migration = await db.all<{ version: number }>(
        'SELECT version FROM _migrations ORDER BY version DESC LIMIT 1',
      );
      const currencies = await db.all<{ c: number }>('SELECT count(*) AS c FROM currency');
      const companies = await db.all<{ c: number }>('SELECT count(*) AS c FROM company');
      setStats({
        tables: tables[0]?.c ?? 0,
        migration: migration[0]?.version ?? null,
        currencies: currencies[0]?.c ?? 0,
        companies: companies[0]?.c ?? 0,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const seedData = useCallback(async () => {
    setBusy(true);
    try {
      const db = await getDb();
      const now = new Date().toISOString();
      await db.transaction(async () => {
        const existing = await db.all<{ id: number }>('SELECT id FROM currency WHERE code = ?', ['YER']);
        const currencyId =
          existing.length > 0
            ? existing[0]?.id ?? 0
            : (
                await db.run(
                  'INSERT INTO currency(code, name, is_base, decimals, is_active) VALUES(?, ?, ?, ?, ?)',
                  ['YER', 'ريال يمني', 1, 0, 1],
                )
              ).lastInsertRowId;
        const companyCount = await db.all<{ c: number }>('SELECT count(*) AS c FROM company');
        if ((companyCount[0]?.c ?? 0) === 0) {
          await db.run(
            'INSERT INTO company(name, currency_id, invoice_prefix, created_at, updated_at) VALUES(?, ?, ?, ?, ?)',
            ['مؤسسة النور التجارية', currencyId, 'INV', now, now],
          );
        }
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const clearData = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    try {
      const { clearWebPersistence } = await import('@/db/engine-web');
      await clearWebPersistence();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {/* الهيدر */}
      <View style={s.header}>
        <View style={s.logoDot} />
        <Text style={s.appName}>{common.appName}</Text>
        <Text style={s.tagline}>{common.tagline}</Text>
      </View>

      {/* بطاقة فحص القاعدة */}
      <View style={s.card}>
        <Text style={s.cardTitle}>{common.dbCheckTitle}</Text>
        {stats === null && error === null ? (
          <View style={s.loadingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={s.loadingText}>{common.loading}</Text>
          </View>
        ) : (
          <>
            <StatRow label={common.tables} value={String(stats?.tables ?? '—')} />
            <StatRow label={common.migrationVersion} value={String(stats?.migration ?? '—')} />
            <StatRow label={common.currencies} value={String(stats?.currencies ?? '—')} />
            <StatRow label={common.companies} value={String(stats?.companies ?? '—')} last />
          </>
        )}
        <Text style={s.engineNote}>{common.engineNote}</Text>
      </View>

      {error !== null ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>{common.errorTitle}</Text>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* الأزرار */}
      <Pressable style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]} disabled={busy} onPress={() => void seedData()}>
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={s.primaryBtnText}>{common.seedData}</Text>}
      </Pressable>

      {Platform.OS === 'web' ? (
        <Pressable style={({ pressed }) => [s.outlineBtn, pressed && s.btnPressed]} onPress={() => void clearData()}>
          <Text style={s.outlineBtnText}>{common.clearData}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function StatRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.statRow, !last && s.statRowDivider]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    alignItems: 'stretch',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoDot: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.accent,
    marginBottom: spacing.md,
  },
  appName: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.display,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  tagline: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  statRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  statValue: {
    // الأرقام بخط IBM Plex (DS-13)
    fontFamily: fonts.numeric,
    fontSize: fontSizes.title,
    color: colors.accent,
  },
  engineNote: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  errorTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.error,
    marginBottom: spacing.xs,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  primaryBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    fontWeight: '700',
    color: colors.bg,
  },
  outlineBtn: {
    borderRadius: radii.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  outlineBtnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
  },
  btnPressed: {
    opacity: 0.8,
  },
});
