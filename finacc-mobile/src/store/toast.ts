import { create } from 'zustand';

export interface ToastOptions {
  /** زر تراجع Undo — يظهر يمين الرسالة (DS-37) */
  undo?: { label?: string; run: () => void };
  /** مدة العرض بالمللي ثانية (الافتراضي 5000 وفق DS-37) */
  duration?: number;
}

interface ToastState {
  visible: boolean;
  message: string;
  undo: { label: string; run: () => void } | null;
  /** إظهار snackbar سفلي — الرسالة الأخيرة تحل محل السابقة */
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
  runUndo: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer() {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/**
 * متجر الرسائل العابرة (DS-37 FeedbackBar) — snackbar سفلي 5 ثوانٍ بزر تراجع.
 * الاستخدام: `useToastStore.getState().show('تم حذف السطر', { undo: { run: restore } })`
 */
export const useToastStore = create<ToastState>((set, get) => ({
  visible: false,
  message: '',
  undo: null,
  show: (message, options) => {
    clearTimer();
    set({
      visible: true,
      message,
      undo: options?.undo
        ? { label: options.undo.label ?? 'تراجع', run: options.undo.run }
        : null,
    });
    hideTimer = setTimeout(() => {
      set({ visible: false });
      hideTimer = null;
    }, options?.duration ?? 5000);
  },
  dismiss: () => {
    clearTimer();
    set({ visible: false });
  },
  runUndo: () => {
    const { undo } = get();
    clearTimer();
    set({ visible: false });
    undo?.run();
  },
}));
