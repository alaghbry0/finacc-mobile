import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import Decimal from 'decimal.js';
import { Minus, Plus } from 'lucide-react-native';
import { BottomSheet } from './BottomSheet';
import { NumberPad, formatInputDisplay } from './NumberPad';
import { PrimaryButton } from './buttons';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface QtyStepperProps {
  /** القيمة كسلسلة رقمية (تدعم الكسور عند allowDecimal) */
  value: string;
  onChange: (next: string) => void;
  /** خطوة التغيير (افتراضي 1) */
  step?: string;
  min?: string;
  max?: string;
  allowDecimal?: boolean;
  disabled?: boolean;
  /** فتح لوحة الأرقام عند النقر على الرقم (افتراضي نعم — DS-39) */
  openPad?: boolean;
  style?: ViewStyle;
}

const START_DELAY = 320;
const MIN_DELAY = 70;
const ACCEL = 0.85;

/** إزالة الأصفار الذيلية من نص رقم عشري («1.500» → «1.5»، «2.0» → «2») */
function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * QtyStepper (DS-39): − / رقم / + بأهداف ≥48×48. النقر على الرقم يفتح NumberPad
 * داخل BottomSheet، والضغط المطوّل يتسارع (interval يتقلص + الخطوة تتضاعف).
 */
export function QtyStepper({
  value,
  onChange,
  step = '1',
  min = '0',
  max,
  allowDecimal = false,
  disabled = false,
  openPad = true,
  style,
}: QtyStepperProps) {
  const [padOpen, setPadOpen] = useState(false);
  const [padValue, setPadValue] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyDelta = useCallback(
    (delta: Decimal) => {
      let next = new Decimal(value || '0').plus(delta);
      const minD = new Decimal(min);
      if (next.lessThan(minD)) next = minD;
      if (max !== undefined && next.greaterThan(new Decimal(max))) next = new Decimal(max);
      onChange(trimZeros(next.toFixed(allowDecimal ? 4 : 0)));
    },
    [value, min, max, allowDecimal, onChange],
  );

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const startAccelerating = useCallback(
    (dir: 1 | -1) => {
      let delay = START_DELAY;
      let scale = 1;
      const fire = () => {
        applyDelta(new Decimal(step).times(dir).times(scale));
        scale = Math.min(scale * 2, 16);
        delay = Math.max(MIN_DELAY, Math.round(delay * ACCEL));
        timer.current = setTimeout(fire, delay);
      };
      timer.current = setTimeout(fire, delay);
    },
    [applyDelta, step],
  );

  const openNumberPad = () => {
    if (!openPad || disabled) return;
    setPadValue(value);
    setPadOpen(true);
  };

  return (
    <View style={[s.wrap, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`-${step}`}
        onPress={() => applyDelta(new Decimal(step).neg())}
        onLongPress={() => startAccelerating(-1)}
        onPressOut={stopTimer}
        disabled={disabled}
        style={({ pressed }) => [s.btn, pressed && s.pressed, disabled && s.disabled]}
      >
        <Minus size={20} color={colors.textPrimary} strokeWidth={2.6} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${common.quantity}: ${formatInputDisplay(value)}`}
        onPress={openNumberPad}
        disabled={disabled}
        style={({ pressed }) => [s.valueBtn, pressed && s.pressed, disabled && s.disabled]}
      >
        <Text style={s.valueText} numberOfLines={1} adjustsFontSizeToFit>
          {formatInputDisplay(value || '0')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`+${step}`}
        onPress={() => applyDelta(new Decimal(step))}
        onLongPress={() => startAccelerating(1)}
        onPressOut={stopTimer}
        disabled={disabled}
        style={({ pressed }) => [s.btn, pressed && s.pressed, disabled && s.disabled]}
      >
        <Plus size={20} color={colors.accent} strokeWidth={2.6} />
      </Pressable>

      <BottomSheet visible={padOpen} onClose={() => setPadOpen(false)} title={common.quantity}>
        <NumberPad
          value={padValue}
          onValue={setPadValue}
          allowDecimal={allowDecimal}
          maxlength={10}
          style={{ paddingHorizontal: spacing.lg }}
          footer={
            <PrimaryButton
              label={common.done}
              onPress={() => {
                const v = padValue.trim();
                if (v.length > 0) {
                  const d = new Decimal(v);
                  const minD = new Decimal(min);
                  const clamped =
                    max !== undefined && d.greaterThan(new Decimal(max))
                      ? new Decimal(max)
                      : d.lessThan(minD)
                        ? minD
                        : d;
                  onChange(trimZeros(clamped.toFixed(allowDecimal ? 4 : 0)));
                }
                setPadOpen(false);
              }}
            />
          }
        />
      </BottomSheet>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btn: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueBtn: {
    minWidth: 64,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  valueText: {
    fontFamily: fonts.numeric,
    fontVariant: ['tabular-nums'],
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});
