import { AppState } from 'react-native';
import { create } from 'zustand';
import { getDb } from '@/db/client';
// دوال الدومين (عقد الوكيل 2-a — src/domain + src/services)
import { verifyPin, recordUnlockSuccess } from '@/domain/auth';
import { isOnboarded } from '@/domain/onboarding';
import { getSetting } from '@/domain/settings';

export type SessionStatus = 'boot' | 'onboarding' | 'locked' | 'unlocked';

export interface SessionUser {
  id: number;
  displayName: string;
  role: string;
}

/** نتيجة التحقق من الرمز — مطابقة بنيوياً لعقد '@/domain/auth'. */
export interface PinVerifyResult {
  ok: boolean;
  lockedForSeconds?: number;
  requirePassphrase?: boolean;
  error?: string;
}

const DEFAULT_AUTOLOCK_MINUTES = 5;
const IDLE_CHECK_INTERVAL = 5000;

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** دقائق الخمول قبل القفل التلقائي (security.autolock_minutes) */
  autolockMinutes: number;
  /** آخر لمسة مستخدم (epoch ms) — تُحدَّث من جذر التطبيق */
  lastActivityAt: number;
  /** الإقلاع: فحص Onboarding ثم قفل (V1: كل إقلاع يقفل — لا جلسات محفوظة) */
  boot: () => Promise<void>;
  lock: () => void;
  /** التحقق من الرمز عبر الدومين ثم فتح الجلسة وتحميل المستخدم ومدة القفل */
  unlock: (pin: string) => Promise<PinVerifyResult>;
  /** فتح مباشر بعد مصادقة موثوقة بديلة (بصمة native / عبارة مرور ناجحة) */
  unlockDirect: () => Promise<void>;
  /** بعد نجاح completeOnboarding في شاشة الإعداد — فتح مباشر */
  markOnboarded: (user: SessionUser) => void;
  /** تسجيل نشاط المستخدم (لمسة) — يعيد مؤقت القفل التلقائي */
  noteActivity: () => void;
  /** مراقبات القفل التلقائي (تُستدعى مرة واحدة من الجذر) */
  startWatchers: () => void;
}

let watchersStarted = false;

/** مشترك بين unlock و unlockAfterBiometric: تسجيل النجاح + تحميل المستخدم + مدة القفل. */
async function postUnlock(
  set: (partial: Partial<SessionState>) => void,
): Promise<void> {
  set({ status: 'unlocked', lastActivityAt: Date.now() });
  // تسجيل نجاح الفتح (سجل تدقيق) — غير حرج
  try {
    await recordUnlockSuccess();
  } catch {
    /* تجاهل */
  }
  // تحميل بيانات المدير (V1: مستخدم واحد ينشئه الإعداد الأول)
  try {
    const db = await getDb();
    const rows = await db.all<{ id: number; display_name: string; role: string }>(
      'SELECT id, display_name, role FROM app_user ORDER BY id LIMIT 1',
    );
    const u = rows[0];
    if (u !== undefined) {
      set({ user: { id: u.id, displayName: u.display_name, role: u.role } });
    }
  } catch {
    /* تجاهل — المدير الافتراضي */
  }
  // مدة القفل التلقائي من الإعدادات (security.autolock_minutes — افتراضي 5)
  try {
    const raw = await getSetting('security.autolock_minutes');
    const minutes = Number(raw);
    if (Number.isFinite(minutes) && minutes > 0) {
      set({ autolockMinutes: minutes });
    } else {
      set({ autolockMinutes: DEFAULT_AUTOLOCK_MINUTES });
    }
  } catch {
    set({ autolockMinutes: DEFAULT_AUTOLOCK_MINUTES });
  }
}

/**
 * متجر الجلسة — مصدر حقيقة التنقل الجذري:
 * boot → onboarding (أول تشغيل) / locked (كل إقلاع) / unlocked.
 * القفل التلقائي: خمول security.autolock_minutes (افتراضي 5) + مراقبة AppState.
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'boot',
  user: null,
  autolockMinutes: DEFAULT_AUTOLOCK_MINUTES,
  lastActivityAt: Date.now(),

  boot: async () => {
    try {
      const onboarded = await isOnboarded();
      set({ status: onboarded ? 'locked' : 'onboarding' });
    } catch {
      // فشل الفحص لا يعلّق التطبيق في boot للأبد — نتيح الإعداد وستظهر أخطاؤه بوضوح
      set({ status: 'onboarding' });
    }
  },

  lock: () => {
    set({ status: 'locked' });
  },

  unlock: async (pin) => {
    const result = await verifyPin(pin);
    if (result.ok) {
      await postUnlock(set);
    }
    return result;
  },

  unlockDirect: async () => {
    await postUnlock(set);
  },

  markOnboarded: (user) => {
    set({ status: 'unlocked', user, lastActivityAt: Date.now(), autolockMinutes: DEFAULT_AUTOLOCK_MINUTES });
  },

  noteActivity: () => {
    set({ lastActivityAt: Date.now() });
  },

  startWatchers: () => {
    if (watchersStarted) return;
    watchersStarted = true;

    const checkIdle = () => {
      const { status, autolockMinutes, lastActivityAt } = get();
      if (
        status === 'unlocked' &&
        autolockMinutes > 0 &&
        Date.now() - lastActivityAt > autolockMinutes * 60_000
      ) {
        get().lock();
      }
    };

    setInterval(checkIdle, IDLE_CHECK_INTERVAL);

    // عند العودة من الخلفية: افحص فورًا (الخمول يشمل زمن البقاء في الخلفية)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkIdle();
    });
    // الجذر يعيش طوال عمر التطبيق — لا حاجة للفك
    void sub;
  },
}));
