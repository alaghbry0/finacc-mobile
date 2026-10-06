import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Share2 } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  AppCard,
  ConfirmSheet,
  EmptyState,
  LoadingSkeleton,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionTitle,
  SelectField,
  type SelectOption,
} from '@/components';
import { common, settings as st, backup as t } from '@/i18n/ar';
import { getSettings, setSetting } from '@/domain/settings';
import {
  backupLog,
  createBackup,
  restoreBackup,
  shareLatestBackup,
  lastBackupAt,
  type BackupLogRow,
} from '@/services/backup';
import { isNativePlatform } from '@/utils/platform';
import { useToastStore } from '@/store/toast';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

/** حجم مقروء: B/KB/MB. */
function fmtSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function kindLabel(kind: string): string {
  if (kind === 'manual') return t.logKindManual;
  if (kind === 'auto') return t.logKindAuto;
  if (kind === 'pre_restore') return t.logKindPreRestore;
  return kind;
}

/**
 * شاشة النسخ الاحتياطي (الوحدة 11): نسخة يدوية بزر واحد (تنزيل على الويب /
 * ملف مشاركة على الجهاز) + الاستعادة بسياسة FR-11-02 الكاملة (تحذير بكلمة
 * «استعادة» + نسخة أمان + فحص إصدار) + الجدولة والاحتفاظ + سجل النسخ.
 */
export default function BackupSettingsScreen() {
  const showToast = useToastStore((s) => s.show);
  const isNative = isNativePlatform();
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<BackupLogRow[]>([]);
  const [lastAt, setLastAt] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [sharing, setSharing] = useState(false);

  const [schedule, setSchedule] = useState('weekly');
  const [retention, setRetention] = useState('7');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, last, all] = await Promise.all([backupLog(), lastBackupAt(), getSettings()]);
      setLog(rows);
      setLastAt(last);
      setSchedule(all['backup.schedule']);
      setRetention(all['backup.retention_count']);
    } catch (e) {
      showToast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const doCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await createBackup('manual');
      showToast(t.createSuccess(res.fileName, fmtSize(res.sizeBytes)), { duration: 7000 });
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.createFailed, { duration: 7000 });
    } finally {
      setCreating(false);
    }
  }, [creating, load, showToast]);

  const doRestore = useCallback(async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const res = await restoreBackup();
      setRestoreOpen(false);
      if (!res.reloaded) {
        showToast(isNative ? t.restoreNativeRestart : t.restoreFailed, { duration: 9000 });
        await load();
      }
      // على الويب: الصفحة أعادت تحميل نفسها من restoreBackup مباشرة
    } catch (e) {
      setRestoreOpen(false);
      showToast(e instanceof Error ? e.message : t.restoreFailed, { duration: 9000 });
    } finally {
      setRestoring(false);
    }
  }, [restoring, isNative, load, showToast]);

  const doShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const path = await shareLatestBackup();
      if (path === null) showToast(t.shareWebHint, { duration: 6000 });
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.createFailed, { duration: 7000 });
    } finally {
      setSharing(false);
    }
  }, [sharing, showToast]);

  const persist = useCallback(
    async (key: 'backup.schedule' | 'backup.retention_count', value: string, setter: (v: string) => void) => {
      setter(value);
      try {
        await setSetting(key, value);
        showToast(st.settingsSaved);
      } catch (e) {
        showToast(e instanceof Error ? e.message : st.settingsSaveFailed, { duration: 7000 });
      }
    },
    [showToast],
  );

  if (loading) {
    return (
      <Screen title={t.title} onBack={() => router.back()}>
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton rows={4} />
      </Screen>
    );
  }

  const scheduleOptions: SelectOption[] = [
    { value: 'daily', label: t.scheduleDaily },
    { value: 'weekly', label: t.scheduleWeekly },
    { value: 'off', label: t.scheduleOff },
  ];
  const retentionOptions: SelectOption[] = Array.from({ length: 30 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  return (
    <Screen title={t.title} onBack={() => router.back()}>
      <SectionTitle
        title={t.sectionCreate}
        hint={lastAt === null ? t.lastBackupNever : `${common.formatDate(lastAt.slice(0, 10))} · ${lastAt.slice(11, 16)}`}
      />
      <AppCard>
        <PrimaryButton label={creating ? t.createBusy : t.createNow} onPress={() => void doCreate()} disabled={creating} />
        <Text style={s.hint}>{isNative ? t.shareLatest : t.webDownloadHint}</Text>
        <SecondaryButton
          label={sharing ? t.createBusy : t.shareLatest}
          onPress={() => void doShare()}
          disabled={sharing || log.length === 0}
        />
      </AppCard>

      <SectionTitle title={t.sectionRestore} />
      <AppCard>
        <SecondaryButton label={t.restoreNow} onPress={() => setRestoreOpen(true)} disabled={restoring} />
        <Text style={s.hint}>{t.restoreWarning}</Text>
      </AppCard>

      <SectionTitle title={t.sectionSchedule} />
      <AppCard>
        <SelectField
          label={t.scheduleLabel}
          value={schedule}
          options={scheduleOptions}
          onSelect={(v) => void persist('backup.schedule', v, setSchedule)}
          hint={t.scheduleHint}
          searchable={false}
        />
        <SelectField
          label={t.retentionLabel}
          value={retention}
          options={retentionOptions}
          onSelect={(v) => void persist('backup.retention_count', v, setRetention)}
          hint={t.retentionHint}
          searchable={false}
        />
      </AppCard>

      <SectionTitle title={t.sectionLog} />
      {log.length === 0 ? (
        <EmptyState title={t.logEmpty} icon={<RefreshCw size={36} color={colors.muted} />} />
      ) : (
        <AppCard flush style={s.logCard}>
          <View style={s.logHead}>
            <Text style={[s.logTh, s.logColAt]}>{t.logColAt}</Text>
            <Text style={s.logTh}>{t.logColKind}</Text>
            <Text style={s.logTh}>{t.logColSize}</Text>
            <Text style={s.logTh}>{t.logColStatus}</Text>
          </View>
          {log.map((row, i) => (
            <View key={row.id} style={[s.logRow, i < log.length - 1 && s.logDivider]}>
              <View style={s.logColAt}>
                <Text style={s.logDate}>{common.formatDate(row.at.slice(0, 10))}</Text>
                <Text style={s.logTime}>{row.at.slice(11, 16)}</Text>
              </View>
              <Text style={s.logCell}>{kindLabel(row.kind)}</Text>
              <Text style={s.logCellMono}>{fmtSize(row.fileSize)}</Text>
              <Text style={[s.logCell, row.status === 'ok' ? s.logOk : s.logBad]}>{row.status === 'ok' ? 'سليمة' : row.status}</Text>
            </View>
          ))}
        </AppCard>
      )}

      <ConfirmSheet
        visible={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onConfirm={() => void doRestore()}
        title={t.restoreTitle}
        message={t.restoreWarning}
        requireText={t.restoreWord}
        confirmLabel={t.restoreNow}
        busy={restoring}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  hint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 16,
  },
  logCard: {
    paddingHorizontal: spacing.md,
  },
  logHead: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  logTh: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.micro,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  logDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.5)',
  },
  logColAt: {
    flex: 1,
    alignItems: 'center',
  },
  logDate: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
  },
  logTime: {
    fontFamily: fonts.numeric,
    fontSize: fontSizes.micro,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  logCell: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  logCellMono: {
    flex: 1,
    fontFamily: fonts.numeric,
    fontSize: fontSizes.caption,
    color: colors.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  logOk: { color: colors.success },
  logBad: { color: colors.error },
});
