import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Lock, ShieldCheck } from 'lucide-react-native';
import { getDb } from '@/db/client';
import { verifyPassphraseAndUnlock } from '@/domain/auth';
import { auth, common, fill } from '@/i18n/ar';
import { colors, fontSizes, fonts, spacing } from '@/theme';
import {
  NumberPad,
  PasswordField,
  PrimaryButton,
  Screen,
  LoadingSkeleton,
} from '@/components';
import { useSessionStore } from '@/store/session';

const WEB = Platform.OS === 'web';
const MAX_ATTEMPTS = 5; // FR-12-06: بعد 5 محاولات تأخير متصاعد

type LoadState = 'loading' | 'ready';

/** شاشة القفل (FR-12): رمز PIN + بصمة (native) + سياسة القفل والمحاولات. */
export default function LoginScreen() {
  const unlock = useSessionStore((s) => s.unlock);
  const unlockDirect = useSessionStore((s) => s.unlockDirect);

  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(MAX_ATTEMPTS);
  const [lockSeconds, setLockSeconds] = useState<number | null>(null);
  const [requirePassphrase, setRequirePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);

  const shake = useRef(new Animated.Value(0)).current;

  // اسم المنشأة من القاعدة (لجعل الشاشة شخصية)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const db = await getDb();
        const rows = await db.all<{ name: string }>('SELECT name FROM company ORDER BY id LIMIT 1');
        if (alive) setCompanyName(rows.length > 0 ? (rows[0]?.name ?? null) : null);
      } catch {
        /* الاسم الافتراضي */
      } finally {
        if (alive) setLoadState('ready');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // البصمة متاحة؟ (native فقط — على الويب الزر مخفي)
  useEffect(() => {
    if (WEB) return;
    let alive = true;
    (async () => {
      try {
        const LocalAuth = await import('expo-local-authentication');
        const has = await LocalAuth.hasHardwareAsync();
        const enrolled = await LocalAuth.isEnrolledAsync();
        if (alive) setBioAvailable(has && enrolled);
      } catch {
        /* غير متاحة */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // العد التنازلي لقفل المحاولات
  useEffect(() => {
    if (lockSeconds === null || lockSeconds <= 0) return;
    const t = setInterval(() => {
      setLockSeconds((v) => (v === null || v <= 1 ? null : v - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [lockSeconds !== null]);

  const doShake = () => {
    Animated.sequence([
      Animated.timing(shake, { toValue: -10, duration: 45, useNativeDriver: !WEB }),
      Animated.timing(shake, { toValue: 10, duration: 45, useNativeDriver: !WEB }),
      Animated.timing(shake, { toValue: -6, duration: 40, useNativeDriver: !WEB }),
      Animated.timing(shake, { toValue: 0, duration: 40, useNativeDriver: !WEB }),
    ]).start();
  };

  const handleVerifyResult = useCallback(
    (result: { ok: boolean; lockedForSeconds?: number; requirePassphrase?: boolean; error?: string }) => {
      if (result.ok) return; // الجذر يتولى التوجيه
      if (result.requirePassphrase === true) {
        setRequirePassphrase(true);
        setErrorMessage(null);
        return;
      }
      if (result.lockedForSeconds !== undefined && result.lockedForSeconds > 0) {
        setLockSeconds(Math.ceil(result.lockedForSeconds));
        setErrorMessage(null);
        setPin('');
        return;
      }
      // رمز خاطئ — اهتزاز + رسالة الدومين (تحوي المحاولات المتبقية) وإلا احتساب محلي
      doShake();
      setPin('');
      const current = attemptsLeft ?? MAX_ATTEMPTS;
      const next = Math.max(0, current - 1);
      setAttemptsLeft(next);
      if (result.error !== undefined && result.error.length > 0) {
        setErrorMessage(result.error);
      } else if (next === 0) {
        setErrorMessage(auth.wrongPin);
      } else if (next === 1) {
        setErrorMessage(auth.attemptRemaining);
      } else {
        setErrorMessage(fill(auth.attemptsRemaining, { n: next }));
      }
    },
    [attemptsLeft],
  );

  const submitPin = useCallback(async () => {
    if (busy || pin.length < 4) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await unlock(pin);
      handleVerifyResult(result);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      doShake();
    } finally {
      setBusy(false);
    }
  }, [busy, pin, unlock, handleVerifyResult]);

  const submitPassphrase = useCallback(async () => {
    if (busy || passphrase.length === 0) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      // فك حجب المحاولات بعبارة المرور عبر الدومين (V1: لا عبارة مرور مخزنة — يفشل دائماً
      // والمعروض حينها هو خيار المسح الكامل من الإعدادات)
      const ok = await verifyPassphraseAndUnlock(passphrase);
      if (ok) {
        await unlockDirect();
      } else {
        setErrorMessage(auth.passphraseWrong);
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, passphrase, unlockDirect]);

  const tryBiometric = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const LocalAuth = await import('expo-local-authentication');
      const res = await LocalAuth.authenticateAsync({
        promptMessage: auth.fingerprint,
        cancelLabel: common.cancel,
      });
      if (res.success) {
        await unlockDirect();
      } else {
        setErrorMessage(auth.fingerprintFailed);
      }
    } catch {
      setErrorMessage(auth.fingerprintFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, unlockDirect]);

  const locked = lockSeconds !== null && lockSeconds > 0;

  if (loadState === 'loading') {
    return (
      <Screen scroll={false}>
        <View style={s.center}>
          <LoadingSkeleton variant="card" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <ScrollView
        style={s.grow}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* الشعار واسم المنشأة */}
        <View style={s.brandCol}>
          <View style={s.lockCircle}>
            <Lock size={34} color={colors.bg} />
          </View>
          <Text style={s.brandName} numberOfLines={2}>
            {companyName ?? common.appName}
          </Text>
          <Text style={s.brandHint}>{auth.unlockHint}</Text>
        </View>

        {/* نقاط إدخال الرمز */}
        <Animated.View style={{ transform: [{ translateX: shake }] }}>
          <View style={s.dotsRow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                style={[
                  s.dot,
                  i < pin.length && s.dotOn,
                  errorMessage !== null && i < pin.length && s.dotError,
                ]}
              />
            ))}
          </View>
          <Text style={[s.statusLine, errorMessage !== null && s.statusError]}>
            {locked
              ? fill(auth.lockedRetryAfter, { s: lockSeconds ?? 0 })
              : (errorMessage ?? auth.unlockTitle)}
          </Text>
        </Animated.View>

        {/* عبارة المرور بعد استنفاد المحاولات */}
        {requirePassphrase ? (
          <View style={s.passWrap}>
            <PasswordField
              label={auth.passphrase}
              value={passphrase}
              onChangeText={(t) => {
                setPassphrase(t);
                setErrorMessage(null);
              }}
              hint={auth.passphraseHint}
            />
            <PrimaryButton
              label={auth.unlock}
              onPress={() => void submitPassphrase()}
              loading={busy}
              disabled={busy || passphrase.length === 0}
            />
          </View>
        ) : (
          <NumberPad
            value={pin}
            onValue={(v) => {
              setPin(v);
              setErrorMessage(null);
            }}
            allowDecimal={false}
            maxlength={6}
            showDisplay={false}
            footer={
              <View style={s.padFooter}>
                {bioAvailable ? (
                  <PrimaryButton
                    label={auth.fingerprint}
                    onPress={() => void tryBiometric()}
                    loading={busy}
                    disabled={busy || locked}
                  />
                ) : null}
                <PrimaryButton
                  label={auth.unlock}
                  onPress={() => void submitPin()}
                  loading={busy}
                  disabled={busy || locked || pin.length < 4}
                />
              </View>
            }
          />
        )}

        <View style={s.secureNote}>
          <ShieldCheck size={14} color={colors.muted} />
          <Text style={s.secureNoteText}>{common.tagline}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    justifyContent: 'center',
    gap: spacing.xl,
  },
  center: { flex: 1, justifyContent: 'center' },
  brandCol: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  lockCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  brandName: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  brandHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignSelf: 'center',
    marginVertical: spacing.sm,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  dotOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  dotError: {
    borderColor: colors.error,
    backgroundColor: colors.error,
  },
  statusLine: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    minHeight: 20,
  },
  statusError: {
    color: colors.error,
    fontFamily: fonts.bodyBold,
  },
  passWrap: {
    gap: spacing.md,
  },
  padFooter: {
    gap: spacing.sm,
  },
  secureNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secureNoteText: {
    fontFamily: fonts.body,
    fontSize: fontSizes.micro,
    color: colors.muted,
  },
});
