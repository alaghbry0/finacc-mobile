import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Archive, ChevronLeft, FolderTree, Plus } from 'lucide-react-native';
import {
  BottomSheet,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingSkeleton,
  Screen,
  SelectField,
  TextField,
  PrimaryButton,
} from '@/components';
import { common, fill, inventory as t } from '@/i18n/ar';
import { colors, fontSizes, fonts, radii, spacing } from '@/theme';
import {
  archiveCategory,
  listCategories,
  upsertCategory,
  type CategoryNode,
} from '@/domain/inventory';
import { useToastStore } from '@/store/toast';

/**
 * إدارة فئات الأصناف (FR-01-05): شجرة بعمق مستويين + إضافة/تعديل (BottomSheet)
 * + أرشفة مع منع وجود أصناف فاعلة على الفئة.
 */
export default function CategoriesScreen() {
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToastStore((s) => s.show);

  // شيت الإضافة/التعديل
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);

  // شيت الأرشفة
  const [archiveTarget, setArchiveTarget] = useState<CategoryNode | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setTree(await listCategories());
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'تعذر تحميل الفئات');
      setTree([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openAdd = (parent?: CategoryNode) => {
    setEditId(null);
    setName('');
    setParentId(parent !== undefined ? String(parent.id) : null);
    setSheetOpen(true);
  };

  const openEdit = (node: CategoryNode, parent: CategoryNode | null) => {
    setEditId(node.id);
    setName(node.name);
    setParentId(parent !== null ? String(parent.id) : null);
    setSheetOpen(true);
  };

  const save = async () => {
    if (name.trim() === '') return;
    setBusy(true);
    try {
      await upsertCategory(editId, name.trim(), parentId !== null ? Number(parentId) : undefined);
      setSheetOpen(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const doArchive = async () => {
    if (archiveTarget === null) return;
    setBusy(true);
    try {
      await archiveCategory(archiveTarget.id);
      setArchiveTarget(null);
      toast(t.categoryArchivedToast);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : common.errorGeneral);
    } finally {
      setBusy(false);
    }
  };

  const topLevelOptions = (tree ?? []).map((c) => ({ value: String(c.id), label: c.name }));

  const renderNode = (node: CategoryNode, parent: CategoryNode | null, isChild: boolean) => (
    <ListRow
      key={node.id}
      title={node.name}
      subtitle={isChild ? t.subcategories : undefined}
      leading={
        <View style={[s.icon, isChild && s.iconChild]}>
          {isChild ? <ChevronLeft size={16} color={colors.muted} /> : <FolderTree size={18} color={colors.accent} />}
        </View>
      }
      trailing={
        <View style={s.rowActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={common.delete}
            onPress={() => setArchiveTarget(node)}
            style={({ pressed }) => [s.miniBtn, pressed && s.pressed]}
            hitSlop={4}
          >
            <Archive size={18} color={colors.error} />
          </Pressable>
        </View>
      }
      onPress={() => openEdit(node, parent)}
      style={isChild ? s.childRow : undefined}
    />
  );

  return (
    <Screen
      title={t.categoriesTitle}
      onBack={() => router.back()}
      actions={[
        {
          icon: <Plus size={22} color={colors.accent} />,
          label: t.addCategory,
          onPress: () => openAdd(),
        },
      ]}
    >
      {failed !== null ? (
        <ErrorState message={failed} onRetry={load} />
      ) : tree === null ? (
        <LoadingSkeleton variant="list" rows={5} />
      ) : tree.length === 0 ? (
        <EmptyState
          icon={<FolderTree size={40} color={colors.accent} />}
          title={t.categoriesEmpty}
          actionLabel={t.addCategory}
          onAction={() => openAdd()}
        />
      ) : (
        <View>
          {tree.map((c) => (
            <View key={c.id}>
              {renderNode(c, null, false)}
              {c.children.map((child) => renderNode(child, c, true))}
              {c.children.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.addCategory}
                  onPress={() => openAdd(c)}
                  style={({ pressed }) => [s.addChild, pressed && s.pressed]}
                >
                  <Plus size={14} color={colors.accent} />
                  <Text style={s.addChildText}>{t.newCategory}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {/* شيت الإضافة/التعديل */}
      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editId !== null ? t.editCategory : t.categorySheetTitle}
      >
        <View style={s.sheetBody}>
          <TextField
            label={t.categoryNameLabel}
            value={name}
            onChangeText={setName}
            placeholder={t.categoryNamePlaceholder}
          />
          {editId === null ? (
            <SelectField
              label={t.parentCategoryLabel}
              value={parentId}
              placeholder={t.noParentCategory}
              options={topLevelOptions}
              searchable={false}
              onSelect={setParentId}
            />
          ) : null}
          <PrimaryButton label={common.save} onPress={save} loading={busy} />
        </View>
      </BottomSheet>

      {/* تأكيد الأرشفة */}
      <ConfirmSheet
        visible={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={doArchive}
        title={t.archiveCategoryTitle}
        message={fill(t.archiveCategoryMessage, { name: archiveTarget?.name ?? '' })}
        busy={busy}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  childRow: {
    marginStart: spacing.xl,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.extra.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChild: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.extra.mutedSoft,
    borderColor: colors.border,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  miniBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.extra.errorSoft,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addChild: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    marginStart: spacing.xl + spacing.md,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  addChildText: {
    fontFamily: fonts.bodyMedium,
    fontSize: fontSizes.caption,
    color: colors.accent,
  },
  sheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: 0.85 },
});
