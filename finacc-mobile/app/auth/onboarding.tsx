import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BarChart3,
  Building2,
  Check,
  ScanBarcode,
  ShieldCheck,
  WifiOff,
} from 'lucide-react-native';
import { getDb } from '@/db/client';
import { completeOnboarding } from '@/domain/onboarding';
import { hashPin } from '@/services/crypto';
import { auth, common } from '@/i18n/ar';
import { colors, fontSizes, fonts, spacing } from '@/theme';
import {
  AppCard,
  ErrorState,
  NumberPad,
  PrimaryButton,
  Screen,
  SelectField,
  TextField,
  type SelectOption,
} from '@/components';
import { useSessionStore, type SessionUser } from '@/store/session';

const WEB = Platform.OS === 'web';
const SLIDE_COUNT = 3;
const STEP_COMPANY = 3;
const STEP_PIN = 4;
const STEP_START = 5;

const SLIDES = [
  {
    icon: <WifiOff size={44} color={colors.accent} />,
    title: auth.slide1Title,
    message: auth.slide1Message,
  },
  {
    icon: <ScanBarcode size={44} color={colors.accent} />,
    title: auth.slide2Title,
    message: auth.slide2Message,
  },
  {
    icon: <BarChart3 size={44} color={colors.accent} />,
    title: auth.slide3Title,
    message: auth.slide3Message,
  },
] as const;

interface CompanyForm {
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  currency: string;
  taxRate: string;
}

const DEFAULT_FORM: CompanyForm = {
  name: '',
  phone: '',
  whatsapp: '',
  address: '',
  currency: 'YER',
  taxRate: '0',
};

/** نقاط تقدم الرمز — تعبئة حسب طول القيمة مع حالة خطأ. */
function PinDots({ length, max = 6, error }: { length: number; max?: number; error?: boolean }) {
  return (
    <View style={s.dotsRow}>
      {Array.from({ length: max }).map((_, i) => (
        <View
          key={i}
          style={[s.dot, i < length && s.dotOn, error === true && i < length && s.dotError]}
        />
      ))}
    </View>
  );
}

export default function OnboardingScreen() {
  const markOnboarded = useSessionStore((s) => s.markOnboarded);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CompanyForm>(DEFAULT_FORM);
  const [formErrors, setFormErrors] = useState<{ name?: string; taxRate?: string }>({});

  const [pin, setPin] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [pinPhase, setPinPhase] = useState<'enter' | 'confirm'>('enter');
  const [pinError, setPinError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const shake = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  // انتقال fade بين الخطوات (DS-28: 180ms بلا مبالغات)
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: !WEB, easing: Easing.out(Easing.quad) }).start();
  }, [step, fade]);

  const doShake = () => {
    Animated.sequence([
      Animated.timing(shake, { toValue: -10, duration: 45, useNativeDriver: !WEB }),
      Animated.timing(shake, { toValue: 10, duration: 45, useNativeDriver: !WEB }),
      Animated.timing(shake, { toValue: -6, duration: 40, useNativeDriver: !WEB }),
      Animated.timing(shake, { toValue: 0, duration: 40, useNativeDriver: !WEB }),
    ]).start();
  };

  const currencyOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'YER', label: common.currencyYER },
      { value: 'SAR', label: common.currencySAR, description: auth.currencyNote },
      { value: 'USD', label: common.currencyUSD, description: auth.currencyNote },
      { value: 'AED', label: common.currencyAED, description: auth.currencyNote },
    ],
    [],
  );

  const goNext = () => setStep((v) => Math.min(v + 1, STEP_START));
  const goPrev = () => setStep((v) => Math.max(v - 1, 0));

  // ===== التحقق من نموذج المنشأة =====
  const validateCompanyForm = (): boolean => {
    const errors: { name?: string; taxRate?: string } = {};
    if (form.name.trim().length === 0) errors.name = common.requiredField;
    const tax = form.taxRate.trim();
    if (tax.length === 0) {
      setForm((f) => ({ ...f, taxRate: '0' }));
    } else if (!/^\d{1,3}(\.\d+)?$/.test(tax) || Number(tax) > 100) {
      errors.taxRate = common.invalidNumber;
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ===== منطق تأكيد الرمز =====
  const handleConfirmValue = (v: string) => {
    setConfirmValue(v);
    setPinError(null);
    if (v.length === pin.length && v.length >= 4) {
      if (v === pin) {
        // تطابق — انتقل لخطوة البدء
        setTimeout(() => setStep(STEP_START), 120);
      } else {
        doShake();
        setPinError(auth.pinMismatch);
        setPinPhase('enter');
        setPin('');
        setConfirmValue('');
      }
    }
  };

  // ===== إنشاء الحساب (hashPin ثم completeOnboarding داخل معاملة الدومين) =====
  const startNow = async () => {
    setCreating(true);
    setFatalError(null);
    try {
      const pinHash = await hashPin(pin);
      await completeOnboarding({
        companyName: form.name.trim(),
        phone: form.phone.trim().length > 0 ? form.phone.trim() : undefined,
        whatsapp: form.whatsapp.trim().length > 0 ? form.whatsapp.trim() : undefined,
        address: form.address.trim().length > 0 ? form.address.trim() : undefined,
        baseCurrencyCode: form.currency,
        taxRate: form.taxRate.trim().length > 0 ? form.taxRate.trim() : '0',
        pinHash,
      });
      // المستخدم المدير الذي أنشأه الدومين — للجلسة
      let user: SessionUser = { id: 1, displayName: form.name.trim(), role: 'admin' };
      try {
        const db = await getDb();
        const rows = await db.all<{ id: number; display_name: string; role: string }>(
          'SELECT id, display_name, role FROM app_user ORDER BY id LIMIT 1',
        );
        const u = rows[0];
        if (u !== undefined) user = { id: u.id, displayName: u.display_name, role: u.role };
      } catch {
        /* الافتراضي أعلاه */
      }
      markOnboarded(user);
      // التوجيه للتبويبات يتم تلقائيًا من الجذر عند تحول الحالة
    } catch (e) {
      setFatalError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  // ===== الواجهة =====
  const slideIndex = step < SLIDE_COUNT ? step : -1;

  return (
    <Screen scroll={false}>
      <ScrollView
        style={s.grow}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[s.stepWrap, { opacity: fade }]} key={step}>
          {/* شرائح الترحيب */}
          {slideIndex >= 0 ? (
            <View style={s.centerCol}>
              <View style={s.slideIconCircle}>{SLIDES[slideIndex]!.icon}</View>
              <Text style={s.slideTitle}>{SLIDES[slideIndex]!.title}</Text>
              <Text style={s.slideMessage}>{SLIDES[slideIndex]!.message}</Text>
              <View style={s.dotsRow}>
                {SLIDES.map((_, i) => (
                  <View key={i} style={[s.dot, i === slideIndex && s.dotOn]} />
                ))}
              </View>
            </View>
          ) : null}

          {/* نموذج بيانات المنشأة */}
          {step === STEP_COMPANY ? (
            <View style={s.formWrap}>
              <View style={s.stepHead}>
                <Building2 size={26} color={colors.accent} />
                <Text style={s.stepTitle}>{auth.companyTitle}</Text>
              </View>
              <Text style={s.stepHint}>{auth.companyHint}</Text>
              <TextField
                label={auth.companyName}
                value={form.name}
                onChangeText={(t) => {
                  setForm((f) => ({ ...f, name: t }));
                  setFormErrors((e) => ({ ...e, name: undefined }));
                }}
                error={formErrors.name}
                required
                placeholder={auth.companyNamePlaceholder}
              />
              <TextField
                label={auth.phone}
                value={form.phone}
                onChangeText={(t) => setForm((f) => ({ ...f, phone: t }))}
                keyboardType="phone-pad"
                hint={common.optionalField}
              />
              <TextField
                label={auth.whatsapp}
                value={form.whatsapp}
                onChangeText={(t) => setForm((f) => ({ ...f, whatsapp: t }))}
                keyboardType="phone-pad"
                hint={common.optionalField}
              />
              <TextField
                label={auth.address}
                value={form.address}
                onChangeText={(t) => setForm((f) => ({ ...f, address: t }))}
                hint={common.optionalField}
              />
              <SelectField
                label={auth.currency}
                value={form.currency}
                options={currencyOptions}
                onSelect={(v) => setForm((f) => ({ ...f, currency: v }))}
                required
              />
              <TextField
                label={auth.taxRate}
                value={form.taxRate}
                onChangeText={(t) => {
                  setForm((f) => ({ ...f, taxRate: t }));
                  setFormErrors((e) => ({ ...e, taxRate: undefined }));
                }}
                error={formErrors.taxRate}
                keyboardType="decimal-pad"
                hint={auth.taxRateHint}
              />
            </View>
          ) : null}

          {/* إنشاء الرمز */}
          {step === STEP_PIN ? (
            <View style={s.pinWrap}>
              <View style={s.stepHead}>
                <ShieldCheck size={26} color={colors.accent} />
                <Text style={s.stepTitle}>{auth.pinTitle}</Text>
              </View>
              <Text style={s.stepHint}>{auth.pinHint}</Text>
              <Animated.View style={{ transform: [{ translateX: shake }] }}>
                <PinDots
                  length={pinPhase === 'enter' ? pin.length : confirmValue.length}
                  error={pinError !== null}
                />
              </Animated.View>
              <Text style={[s.pinPhase, pinError !== null && s.pinPhaseError]}>
                {pinError ?? (pinPhase === 'enter' ? auth.pinEnter : auth.pinReenter)}
              </Text>
              <NumberPad
                value={pinPhase === 'enter' ? pin : confirmValue}
                onValue={pinPhase === 'enter' ? setPin : handleConfirmValue}
                allowDecimal={false}
                maxlength={6}
                showDisplay={false}
              />
            </View>
          ) : null}

          {/* البدء */}
          {step === STEP_START ? (
            <View style={s.formWrap}>
              <View style={s.stepHead}>
                <Check size={26} color={colors.success} />
                <Text style={s.stepTitle}>{auth.startNow}</Text>
              </View>
              {fatalError !== null ? (
                <AppCard>
                  <ErrorState
                    title={auth.setupFailedTitle}
                    message={auth.setupFailedMessage}
                    detail={fatalError}
                    onRetry={() => void startNow()}
                  />
                </AppCard>
              ) : (
                <>
                  <AppCard>
                    <View style={s.recapRow}>
                      <Text style={s.recapLabel}>{auth.companyName}</Text>
                      <Text style={s.recapValue} numberOfLines={1}>
                        {form.name.trim()}
                      </Text>
                    </View>
                    <View style={s.recapRow}>
                      <Text style={s.recapLabel}>{auth.currency}</Text>
                      <Text style={s.recapValue}>
                        {currencyOptions.find((o) => o.value === form.currency)?.label ?? form.currency}
                      </Text>
                    </View>
                    <View style={[s.recapRow, s.recapLast]}>
                      <Text style={s.recapLabel}>{auth.taxRate}</Text>
                      <Text style={s.recapValue}>{form.taxRate || '0'}%</Text>
                    </View>
                  </AppCard>
                  <View style={s.startBtnWrap}>
                    <PrimaryButton
                      label={creating ? auth.creatingAccount : auth.startNow}
                      onPress={() => void startNow()}
                      loading={creating}
                      disabled={creating}
                    />
                  </View>
                </>
              )}
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>

      {/* أزرار التنقل السفلية */}
      {fatalError === null && step !== STEP_START ? (
        <View style={s.footer}>
          {step < SLIDE_COUNT ? (
            <Text style={s.skipBtn} onPress={() => setStep(STEP_COMPANY)}>
              {auth.skip}
            </Text>
          ) : (
            <View style={{ width: 1 }} />
          )}
          <View style={s.footerNav}>
            {step > 0 && step !== STEP_PIN ? (
              <Text style={s.prevBtn} onPress={goPrev} accessibilityRole="button">
                {common.previous}
              </Text>
            ) : (
              <View style={{ width: 1 }} />
            )}
            {step < SLIDE_COUNT ? (
              <PrimaryButton label={common.next} onPress={goNext} />
            ) : null}
            {step === STEP_COMPANY ? (
              <PrimaryButton
                label={common.next}
                onPress={() => {
                  if (validateCompanyForm()) goNext();
                }}
              />
            ) : null}
            {step === STEP_PIN && pinPhase === 'enter' ? (
              <PrimaryButton
                label={auth.pinConfirm}
                onPress={() => {
                  if (pin.length < 4) {
                    doShake();
                    setPinError(auth.pinTooShort);
                    return;
                  }
                  setPinError(null);
                  setPinPhase('confirm');
                  setConfirmValue('');
                }}
                disabled={pin.length < 4}
              />
            ) : null}
            {step === STEP_PIN && pinPhase === 'confirm' ? (
              <Text style={s.prevBtn} onPress={() => { setPinPhase('enter'); setConfirmValue(''); setPinError(null); }}>
                {auth.backToPin}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxl },
  stepWrap: { flex: 1 },
  centerCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  slideIconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.display,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  slideMessage: {
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 340,
  },
  formWrap: { gap: spacing.md, paddingTop: spacing.md },
  stepHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.title,
    color: colors.textPrimary,
  },
  stepHint: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: spacing.xs,
  },
  pinWrap: { gap: spacing.md, paddingTop: spacing.md },
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignSelf: 'center',
    marginVertical: spacing.sm,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  dotOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  dotError: {
    borderColor: colors.error,
    backgroundColor: colors.error,
  },
  pinPhase: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    minHeight: 20,
  },
  pinPhaseError: {
    color: colors.error,
  },
  recapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  recapLast: { borderBottomWidth: 0 },
  recapLabel: {
    fontFamily: fonts.body,
    fontSize: fontSizes.caption,
    color: colors.textSecondary,
  },
  recapValue: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  startBtnWrap: { marginTop: spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  footerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skipBtn: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.muted,
    minHeight: 48,
    textAlignVertical: 'center',
  },
  prevBtn: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.body,
    color: colors.textSecondary,
    minHeight: 48,
    textAlignVertical: 'center',
  },
});
