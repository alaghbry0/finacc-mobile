import { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { ScanBarcode, X } from 'lucide-react-native';
import { common } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';

interface SearchBarProps extends TextInputProps {
  /** عند تمريرها تظهر أيقونة مسح باركود مدمجة (DS-21) */
  onScan?: () => void;
  scanIcon?: ReactNode;
  right?: ReactNode;
  containerStyle?: ViewStyle;
}

/** SearchBar (DS-21): حقل بحث بأيقونة مسح باركود مدمجة + زر مسح نص. */
export function SearchBar({ onScan, scanIcon, right, containerStyle, value, ...inputProps }: SearchBarProps) {
  const text = typeof value === 'string' ? value : '';
  return (
    <View style={[s.wrap, containerStyle]}>
      <View style={s.field}>
        <Text style={s.searchIcon} pointerEvents="none">
          ⌕
        </Text>
        <TextInput
          value={value}
          placeholderTextColor={colors.muted}
          underlineColorAndroid="transparent"
          {...inputProps}
          style={[s.input, inputProps.style]}
          accessibilityLabel={common.search}
        />
        {text.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={common.clear}
            onPress={() => inputProps.onChangeText?.('')}
            style={({ pressed }) => [s.clearBtn, pressed && s.pressed]}
            hitSlop={6}
          >
            <X size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {onScan !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={common.scanBarcode}
            onPress={onScan}
            style={({ pressed }) => [s.scanBtn, pressed && s.pressed]}
          >
            {scanIcon !== undefined ? scanIcon : <ScanBarcode size={22} color={colors.accent} />}
          </Pressable>
        ) : null}
        {right}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  searchIcon: {
    fontSize: 20,
    color: colors.muted,
    includeFontPadding: false,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.body,
    color: colors.textPrimary,
    paddingVertical: 10,
    textAlign: 'right',
  },
  clearBtn: {
    width: 32,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -10,
    marginHorizontal: -12,
    backgroundColor: colors.extra.accentSoft,
    borderTopLeftRadius: radii.md,
    borderBottomLeftRadius: radii.md,
  },
  pressed: { opacity: 0.85 },
});
