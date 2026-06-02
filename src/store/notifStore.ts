import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotifPrefs {
  insights_weekly: boolean;
  budget_overspend: boolean;
  goal_milestone: boolean;
  partner_activity: boolean;
}

interface NotifState extends NotifPrefs {
  setPreference: (key: keyof NotifPrefs, value: boolean) => void;
}

export const useNotifStore = create<NotifState>()(
  persist(
    (set) => ({
      insights_weekly: true,
      budget_overspend: true,
      goal_milestone: true,
      partner_activity: true,
      setPreference: (key, value) => set({ [key]: value }),
    }),
    { name: 'morchis-notif-prefs' },
  ),
);
