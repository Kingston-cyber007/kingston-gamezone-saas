import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Settings {
  posteCount: number;
  warnMinutes: number;
  prices: Record<number, number>;
  customPricePerMinute: number;
  priceDrink: number;
  staffPassword: string;
  soundMuted: boolean;
  soundVolume: number;
  voiceEnabled: boolean;
  customSounds: Record<string, string>; // posteId -> base64 data URL
  notificationsEnabled: boolean;
}

export interface Poste {
  id: string;
  name: string;
  status: 'idle' | 'busy';
  durationMin: number | null;
  startedAt: number | null;
  endsAt: number | null;
  paused: boolean;
  remainingMs: number | null;
  drinkCount: number;
  emoji: string | null;
  ticketId: string | null;
  ticketCode: string | null;
  clientName: string | null;
}

export interface Ticket {
  id: string;
  nom: string;
  prenom: string;
  age: number;
  code: string;
  dateCreation: number;
  dateExpiration: number;
  savedRemainingMs: number | null;
  usedSavedTime: boolean;
  totalMinutesPlayed: number;
  totalAmount: number;
  sessionIds: string[];
}

export type PaymentMethod = 'cash' | 'airtel_money' | 'mtn_money';

export interface Session {
  id: string;
  posteId: string;
  posteName: string;
  ts: number;
  durationMin: number;
  drinkCount: number;
  amount: number;
  day: string;
  ticketId: string | null;
  ticketCode: string | null;
  clientName: string | null;
  paymentMethod: PaymentMethod;
}

interface State {
  settings: Settings;
  postes: Poste[];
  sessions: Session[];
  tickets: Ticket[];
  updateSettings: (s: Partial<Settings>) => void;
  setPostes: (p: Poste[]) => void;
  updatePoste: (id: string, data: Partial<Poste>) => void;
  addSession: (s: Session) => void;
  addTicket: (t: Ticket) => void;
  updateTicket: (id: string, data: Partial<Ticket>) => void;
  clearTodaySessions: () => void;
  todayKey: () => string;
}

function makeTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DEFAULT_SETTINGS: Settings = {
  posteCount: 5,
  warnMinutes: 5,
  prices: { 30: 500, 60: 900, 90: 1300, 120: 1600 },
  customPricePerMinute: 15,
  priceDrink: 200,
  staffPassword: 'kingston2026',
  soundMuted: false,
  soundVolume: 0.5,
  voiceEnabled: true,
  customSounds: {},
  notificationsEnabled: false,
};

function buildPostes(count: number, existing: Poste[]): Poste[] {
  const postes: Poste[] = [];
  for (let i = 1; i <= count; i++) {
    const id = 'p' + i;
    const ex = existing.find(p => p.id === id);
    postes.push(ex ?? {
      id, name: 'Poste ' + i, status: 'idle',
      durationMin: null, startedAt: null, endsAt: null,
      paused: false, remainingMs: null, drinkCount: 0,
      emoji: null, ticketId: null, ticketCode: null, clientName: null,
    });
  }
  return postes;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      postes: buildPostes(DEFAULT_SETTINGS.posteCount, []),
      sessions: [],
      tickets: [],
      updateSettings: (s) => set(st => {
        const next = { ...st.settings, ...s };
        let postes = st.postes;
        if (s.posteCount !== undefined) {
          postes = buildPostes(s.posteCount, st.postes);
        }
        return { settings: next, postes };
      }),
      setPostes: (p) => set({ postes: p }),
      updatePoste: (id, data) => set(st => ({
        postes: st.postes.map(p => p.id === id ? { ...p, ...data } : p)
      })),
      addSession: (s) => set(st => {
        const sessions = [...st.sessions, s];
        const tickets = st.tickets.map(t => {
          if (t.id === s.ticketId) {
            return {
              ...t,
              totalMinutesPlayed: t.totalMinutesPlayed + s.durationMin,
              totalAmount: t.totalAmount + s.amount,
              sessionIds: [...t.sessionIds, s.id],
            };
          }
          return t;
        });
        return { sessions, tickets };
      }),
      addTicket: (t) => set(st => ({ tickets: [...st.tickets, t] })),
      updateTicket: (id, data) => set(st => ({
        tickets: st.tickets.map(t => t.id === id ? { ...t, ...data } : t)
      })),
      clearTodaySessions: () => set(st => ({
        sessions: st.sessions.filter(s => s.day !== makeTodayKey())
      })),
      todayKey: makeTodayKey,
    }),
    {
      name: 'kg_caisse_v3',
      partialize: (state) => ({
        settings: state.settings,
        postes: state.postes,
        sessions: state.sessions,
        tickets: state.tickets,
      }),
      // Deep-merge persisted settings with DEFAULT_SETTINGS so new fields
      // (voiceEnabled, customSounds, etc.) are always present after upgrades.
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(persisted?.settings ?? {}),
          // always ensure customSounds is an object, never undefined
          customSounds: persisted?.settings?.customSounds ?? {},
          notificationsEnabled: persisted?.settings?.notificationsEnabled ?? false,
        },
        // backfill paymentMethod for sessions persisted before this field existed
        sessions: (persisted?.sessions ?? []).map((s: any) => ({
          ...s,
          paymentMethod: s.paymentMethod ?? 'cash',
        })),
      }),
    }
  )
);
