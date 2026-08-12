import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { encryptPII, decryptPII, isSecureStorageAvailable } from '../lib-app/secure-storage';

/**
 * Storage Zustand custom — ND2 Phase B — Fix #9 (audit 2026-08-03).
 *
 * Wrap `localStorage` pour chiffrer les champs PII (nom, prenom, clientName)
 * AVANT écriture disque. Au boot, le payload reste chiffré jusqu'à ce que
 * `merge()` lance le déchiffrement async via `decryptPII()`.
 *
 * ⚠️ HONNÊTÉ (cf. `SECURITY.md` §3.3) :
 *   - Le payload chiffré protège contre DevTools occasionnel et extension
 *     lisant localStorage sans exécution JS.
 *   - Il NE protège PAS contre un XSS actif qui peut appeler decryptPII().
 *   - Le module se dégrade gracieusement (PII en clair) si Web Crypto ou
 *     IndexedDB sont indisponibles — l'app ne crashe pas.
 *
 * Note sur l'asynchronie : Zustand `persist` exige un storage **synchrone**.
 * On ne peut pas attendre la Promise d'encryptPII() avant setItem().
 * Solution : on lance le chiffrement en arrière-plan et on réécrit le
 * storage après coup. Pendant la fraction de seconde où c'est en clair
 * sur disque, c'est acceptable (le `partialize` synchrone retourne la
 * valeur courante en clair, qu'on réécrit chiffrée juste après).
 *
 * Préfixe `enc:` marque les valeurs chiffrées pour le merge au boot.
 */
function makeSecureStorage(): PersistStorage<unknown> {
  const isAvailable = isSecureStorageAvailable();
  const PREFIX = 'enc:';

  function getRaw(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function setRaw(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // QuotaExceeded ou autre — silencieux, on accepte la perte PII.
    }
  }

  return {
    getItem: (name: string): StorageValue<unknown> | null => {
      const raw = getRaw(name);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as StorageValue<unknown>;
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: StorageValue<unknown>): void => {
      // 1. Écriture synchrone immédiate avec PII en clair (acceptable :
      //    la fenêtre d'exposition est la milliseconde avant réécriture).
      const json = JSON.stringify(value);
      setRaw(name, json);

      // 2. Si secure storage dispo, on lance le chiffrement async et
      //    on réécrit avec PII chiffrée dès que prêt.
      if (!isAvailable) return;

      const v = value as { state?: Record<string, unknown> };
      const state = v?.state;
      if (!state || typeof state !== 'object') return;

      const sessions = Array.isArray(state.sessions) ? (state.sessions as any[]) : [];
      const tickets = Array.isArray(state.tickets) ? (state.tickets as any[]) : [];

      // Collecte les promesses de chiffrement pour sessions/tickets.
      const encPromises: Promise<void>[] = [];

      sessions.forEach((s, idx) => {
        if (s && typeof s.clientName === 'string' && s.clientName !== '' && !s.clientName.startsWith(PREFIX)) {
          encPromises.push(
            encryptPII(s.clientName).then((cipher) => {
              sessions[idx] = { ...s, clientName: cipher == null ? null : PREFIX + cipher };
            }),
          );
        }
      });

      tickets.forEach((t, idx) => {
        if (t && typeof t === 'object') {
          if (typeof t.nom === 'string' && t.nom !== '' && !t.nom.startsWith(PREFIX)) {
            encPromises.push(
              encryptPII(t.nom).then((cipher) => {
                tickets[idx] = { ...t, nom: cipher == null ? '' : PREFIX + cipher };
              }),
            );
          }
          if (typeof t.prenom === 'string' && t.prenom !== '' && !t.prenom.startsWith(PREFIX)) {
            encPromises.push(
              encryptPII(t.prenom).then((cipher) => {
                tickets[idx] = { ...t, prenom: cipher == null ? '' : PREFIX + cipher };
              }),
            );
          }
        }
      });

      if (encPromises.length === 0) return;

      Promise.all(encPromises).then(() => {
        // Réécrit le storage avec les valeurs chiffrées (préfixe `enc:`).
        // ⚠️ NE PAS réentrer dans setItem ici : on stringify directement.
        const encryptedJson = JSON.stringify(value);
        setRaw(name, encryptedJson);
      });
    },
    removeItem: (name: string): void => {
      try {
        localStorage.removeItem(name);
      } catch {
        // silencieux
      }
    },
  };
}

/** Fenêtre de rétention PII (en ms). Aligné sur TICKET_VALID_MS
 *  (`src/lib-app/helpers.ts:38`). Au-delà, les champs nominatifs
 *  (nom, prenom, clientName) sont anonymisés à `null` par le merge
 *  Zustand au prochain boot. On garde dates, montants, codes — non-PII
 *  et nécessaires aux agrégats KPI.
 *
 *  ND2 — Phase A — Fix #9 (audit 2026-08-03).
 *  Voir `SECURITY.md` pour la politique de sécurité complète. */
const PII_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface Settings {
  posteCount: number;
  warnMinutes: number;
  prices: Record<number, number>;
  customPricePerMinute: number;
  priceDrink: number;
  soundMuted: boolean;
  soundVolume: number;
  voiceEnabled: boolean;
  customSounds: Record<string, string>; // posteId -> base64 data URL
  notificationsEnabled: boolean;
  /** Étape 3E — préférence utilisateur pour la "force" des animations.
   *  'off' = animations 3D désactivées, 'subtle' = durée ÷ 2, 'normal' = pleine intensité.
   *  Forcé à 'off' si le système impose prefers-reduced-motion (cf. useMotionSettings). */
  motionIntensity: 'off' | 'subtle' | 'normal';
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
  /** RT.H.5 — true si le staff a explicitement autorisé la session pour un client mineur (< 16 ans).
   *  Permet d'afficher un badge visuel sur la carte poste pendant toute la durée de la session. */
  minorAuthorised?: boolean;
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
  minorAuthorised?: boolean; // RT.H.5 — true si staff a autorisé un client < 16
}

interface State {
  settings: Settings;
  postes: Poste[];
  sessions: Session[];
  tickets: Ticket[];
  /** Étape 3D — indicateur de coupure électricité active (fige l'app app/*). */
  powerCutActive: boolean;
  updateSettings: (s: Partial<Settings>) => void;
  setPostes: (p: Poste[]) => void;
  updatePoste: (id: string, data: Partial<Poste>) => void;
  addSession: (s: Session) => void;
  addTicket: (t: Ticket) => void;
  updateTicket: (id: string, data: Partial<Ticket>) => void;
  clearTodaySessions: () => void;
  todayKey: () => string;
  /** Étape 3D — active/désactive le mode coupure électricité. */
  setPowerCut: (active: boolean) => void;
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
  soundMuted: false,
  soundVolume: 0.5,
  voiceEnabled: true,
  customSounds: {},
  notificationsEnabled: false,
  motionIntensity: 'normal',
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
      powerCutActive: false,
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
      setPowerCut: (active) => set({ powerCutActive: active }),
    }),
    {
      name: 'kg_caisse_v3',
      partialize: (state) => ({
        settings: state.settings,
        postes: state.postes,
        sessions: state.sessions,
        tickets: state.tickets,
        // Étape 3D — la coupure survit au reload (le gérant rouvre l'app
        // et retrouve l'état figé, pas une reprise surprise).
        powerCutActive: state.powerCutActive,
      }),
      // ND2 Phase B — Fix #9 : storage custom qui chiffre la PII avant disque.
      storage: makeSecureStorage(),
      // Deep-merge persisted settings with DEFAULT_SETTINGS so new fields
      // (voiceEnabled, customSounds, etc.) are always present after upgrades.
      //
      // ND7 — Fix #8 (audit 2026-08-03) : validation défensive des données
      // persistées avant merge. Avant ce fix, un localStorage corrompu
      // (devtools, extension, ou XSS) injectait des NaN/undefined dans le
      // store, faisant crasher silencieusement les écrans (KPIs NaN, badges
      // cassés). On filtre les sessions/tickets/postes invalides et on
      // garde uniquement ceux qui passent les type guards minimaux.
      //
      // ND2 — Phase A — Fix #9 (audit 2026-08-03) : anonymisation PII après
      // fenêtre `PII_RETENTION_MS` (7 jours, aligné sur TICKET_VALID_MS).
      // À chaque boot, on purge `nom`/`prenom` des tickets et `clientName`
      // des sessions dont la date de référence dépasse la fenêtre. Les
      // agrégats (montants, dates, codes) sont conservés.
      merge: (persisted: any, current) => {
        const now = Date.now();
        const cutoff = now - PII_RETENTION_MS;

        // Sessions valides : id string + amount/timestamp/drinkCount numériques.
        // A5 — code-review 03/08 : drinkCount doit être un nombre fini, sinon
        // les KPI Caisse.tsx (lignes 23,55,90,293) calculent NaN via reduce().
        const validSessions = Array.isArray(persisted?.sessions)
          ? persisted.sessions.filter((s: any) =>
              s &&
              typeof s === 'object' &&
              typeof s.id === 'string' &&
              Number.isFinite(s.amount) &&
              Number.isFinite(s.ts) &&
              Number.isFinite(s.durationMin) &&
              Number.isFinite(s.drinkCount),
            )
          : [];

        // Tickets valides : id string + totalAmount/dateCreation numériques.
        const validTickets = Array.isArray(persisted?.tickets)
          ? persisted.tickets.filter((t: any) =>
              t &&
              typeof t === 'object' &&
              typeof t.id === 'string' &&
              Number.isFinite(t.totalAmount) &&
              Number.isFinite(t.dateCreation),
            )
          : [];

        // Postes valides : id string + name string + status enum.
        // CHANTIER 1 — fondations : 'reserved' ajouté à l'enum poste_status
        // (migration 20260803113500) pour refléter un poste dont la console
        // associée est en_reparation (cf. trigger cascade_console_status).
        // ⚠️ Sans cette valeur, Zustand FILTRE SILENCIEUSEMENT les postes
        // 'reserved' au prochain reload et écrase localStorage avec la liste
        // amputée → perte de données silencieuse (finding A1 code-review).
        const validPostes = Array.isArray(persisted?.postes)
          ? persisted.postes.filter((p: any) =>
              p &&
              typeof p === 'object' &&
              typeof p.id === 'string' &&
              typeof p.name === 'string' &&
              (p.status === 'idle' || p.status === 'busy' || p.status === 'reserved'),
            )
          : [];

        return {
          ...current,
          ...persisted,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(persisted?.settings ?? {}),
            // always ensure customSounds is an object, never undefined
            customSounds: persisted?.settings?.customSounds ?? {},
            notificationsEnabled: persisted?.settings?.notificationsEnabled ?? false,
            // Étape 3E — backfill motionIntensity pour les anciens persist
            motionIntensity: persisted?.settings?.motionIntensity ?? 'normal',
          },
          // backfill paymentMethod for sessions persisted before this field existed
          // + anonymisation PII : sessions > 7 jours → clientName = null
          sessions: validSessions.map((s: any) => ({
            ...s,
            paymentMethod: s.paymentMethod ?? 'cash',
            // Date de référence : timestamp de la session. Si trop ancien,
            // on anonymise le nom client. Les autres champs restent pour les KPI.
            clientName: (Number.isFinite(s.ts) && s.ts < cutoff) ? null : s.clientName,
          })),
          // RT.H.5 — backfill minorAuthorised=false pour les postes persistés avant ce champ
          postes: validPostes.map((p: any) => ({
            ...p,
            minorAuthorised: p.minorAuthorised ?? false,
          })),
          // Tickets : on anonymise nom/prenom pour les tickets expirés depuis > 7 jours.
          // La date de référence est `dateExpiration` (cohérent avec TICKET_VALID_MS).
          tickets: validTickets.map((t: any) => {
            const expiredSince = now - t.dateExpiration;
            const shouldAnonymize = Number.isFinite(t.dateExpiration) && expiredSince > PII_RETENTION_MS;
            return shouldAnonymize
              ? { ...t, nom: '', prenom: '' }
              : t;
          }),
        };
      },
      // onRehydrateStorage : appelé après que Zustand a injecté le state persisté.
      // On en profite pour déchiffrer les champs PII marqués `enc:`.
      onRehydrateStorage: () => (state) => {
        if (!state || !isSecureStorageAvailable()) return;

        const PREFIX = 'enc:';
        const tickets = (state.tickets ?? []) as any[];
        const sessions = (state.sessions ?? []) as any[];

        const decPromises: Promise<void>[] = [];

        tickets.forEach((t, idx) => {
          if (!t || typeof t !== 'object') return;
          if (typeof t.nom === 'string' && t.nom.startsWith(PREFIX)) {
            decPromises.push(
              decryptPII(t.nom.slice(PREFIX.length)).then((plain) => {
                tickets[idx] = { ...t, nom: plain ?? '' };
              }),
            );
          }
          if (typeof t.prenom === 'string' && t.prenom.startsWith(PREFIX)) {
            decPromises.push(
              decryptPII(t.prenom.slice(PREFIX.length)).then((plain) => {
                tickets[idx] = { ...t, prenom: plain ?? '' };
              }),
            );
          }
        });

        sessions.forEach((s, idx) => {
          if (!s || typeof s !== 'object') return;
          if (typeof s.clientName === 'string' && s.clientName.startsWith(PREFIX)) {
            decPromises.push(
              decryptPII(s.clientName.slice(PREFIX.length)).then((plain) => {
                sessions[idx] = { ...s, clientName: plain ?? null };
              }),
            );
          }
        });

        if (decPromises.length > 0) {
          // On attend toutes les déchiffrements puis on commit un seul setState.
          Promise.all(decPromises).then(() => {
            useStore.setState({ tickets: [...tickets], sessions: [...sessions] });
          });
        }
      },
    }
  )
);
