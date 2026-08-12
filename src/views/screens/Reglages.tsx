import { useState, useRef } from 'react';
import { useStore, DEFAULT_SETTINGS } from '../../store/useStore';
import { playAlertSound, speakWarning, speakExpired, isSpeechSupported, playCustomSound } from '../../lib-app/audio';
import { showToast } from '../components/Toast';
import { requestNotificationPermission, notificationPermissionState } from '../../lib-app/notifications';
import { useI18n, LOCALES } from '../../i18n';
import { useMotionSettings } from '../hooks/useMotionSettings';

export function ReglagesView() {
  const { settings, postes, updateSettings, updatePoste } = useStore();
  const { locale, setLocale } = useI18n();
  const { prefersReduced } = useMotionSettings();
  const [notifState, setNotifState] = useState(notificationPermissionState());
  const importRef = useRef<HTMLInputElement>(null);

  // ── Backup / Restore ────────────────────────────────────────
  function exportData() {
    const state = useStore.getState();
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      postes: state.postes,
      sessions: state.sessions,
      tickets: state.tickets,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kingston-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Données exportées', '📦');
  }

  /**
   * ND8 — Fix #7 (audit 2026-08-03) : validation défensive des imports.
   * Avant ce fix, n'importe quel JSON avec `settings`/`sessions[]`/`tickets[]`
   * était accepté — un `amount: "abc"` ou `paymentMethod: "🧨"` cassait
   * silencieusement l'app (calculs NaN, badges cassés, etc.).
   * Pas de Zod/Valibot (règle 5), validation explicite inline.
   */

  const VALID_PAYMENT_METHODS = ['cash', 'airtel_money', 'mtn_money'] as const;
  const VALID_TICKET_STATUS = ['valid', 'exhausted', 'expired'] as const;

  function isValidSession(s: unknown): s is {
    id: string;
    posteId: string;
    posteName: string;
    durationMin: number;
    amount: number;
    ts: number;
    day: string;
    paymentMethod: 'cash' | 'airtel_money' | 'mtn_money';
    drinkCount: number;
    clientName?: string | null;
    ticketId?: string | null;
    ticketCode?: string | null;
    minorAuthorised?: boolean;
    endsAt?: number;
  } {
    if (!s || typeof s !== 'object') return false;
    const o = s as Record<string, unknown>;
    return (
      typeof o.id === 'string' &&
      typeof o.posteId === 'string' &&
      typeof o.posteName === 'string' &&
      Number.isFinite(o.durationMin) &&
      Number.isFinite(o.amount) &&
      typeof o.ts === 'number' && Number.isFinite(o.ts) &&
      typeof o.day === 'string' &&
      typeof o.paymentMethod === 'string' &&
      (VALID_PAYMENT_METHODS as readonly string[]).includes(o.paymentMethod) &&
      Number.isFinite(o.drinkCount)
    );
  }

  function isValidTicket(t: unknown): t is {
    id: string;
    code: string;
    nom: string;
    prenom: string;
    age: number;
    dateCreation: number;
    dateExpiration: number;
    totalAmount: number;
    usedSavedTime: boolean;
  } {
    if (!t || typeof t !== 'object') return false;
    const o = t as Record<string, unknown>;
    return (
      typeof o.id === 'string' &&
      typeof o.code === 'string' &&
      typeof o.nom === 'string' &&
      typeof o.prenom === 'string' &&
      Number.isFinite(o.age) &&
      Number.isFinite(o.dateCreation) &&
      Number.isFinite(o.dateExpiration) &&
      Number.isFinite(o.totalAmount) &&
      typeof o.usedSavedTime === 'boolean'
    );
  }

  function isValidPoste(p: unknown): p is {
    id: string;
    name: string;
    emoji?: string;
    status: 'idle' | 'busy';
    paused?: boolean;
    remainingMs?: number | null;
  } {
    if (!p || typeof p !== 'object') return false;
    const o = p as Record<string, unknown>;
    return (
      typeof o.id === 'string' &&
      typeof o.name === 'string' &&
      (o.status === 'idle' || o.status === 'busy')
    );
  }

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data || typeof data !== 'object') throw new Error('Format invalide');

        // Sessions : chaque entrée doit être valide. On filtre les invalides
        // et on loggue combien ont été rejetées (sécurité > silencieux).
        const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
        const validSessions = rawSessions.filter(isValidSession);
        const rejectedSessions = rawSessions.length - validSessions.length;

        // Tickets : idem.
        const rawTickets = Array.isArray(data.tickets) ? data.tickets : [];
        const validTickets = rawTickets.filter(isValidTicket);
        const rejectedTickets = rawTickets.length - validTickets.length;

        // Postes : tableau requis et chaque entrée valide.
        const rawPostes = Array.isArray(data.postes) ? data.postes : [];
        const validPostes = rawPostes.filter(isValidPoste);

        // Settings : on part de DEFAULT_SETTINGS et on n'autorise que les
        // champs définis — évite l'injection de clés arbitraires dans le store.
        const safeSettings: typeof DEFAULT_SETTINGS = {
          ...DEFAULT_SETTINGS,
          ...(typeof data.settings === 'object' && data.settings !== null
            ? Object.fromEntries(
                Object.entries(data.settings).filter(([k]) => k in DEFAULT_SETTINGS),
              )
            : {}),
        };

        if (!window.confirm(
          `Cette action remplacera TOUTES les données actuelles (tickets, sessions, réglages).${
            rejectedSessions + rejectedTickets > 0
              ? `\n\n⚠️ ${rejectedSessions} session(s) et ${rejectedTickets} ticket(s) invalides seront ignorés.`
              : ''
          }\nContinuer ?`
        )) return;

        useStore.setState({
          settings: safeSettings,
          postes: validPostes,
          sessions: validSessions,
          tickets: validTickets,
        });
        const warnings = rejectedSessions + rejectedTickets > 0
          ? ` (${rejectedSessions} session(s) et ${rejectedTickets} ticket(s) invalides ignorés)`
          : '';
        showToast(`Données restaurées avec succès${warnings}`, rejectedSessions + rejectedTickets > 0 ? '⚠️' : '✅');
      } catch {
        showToast('Fichier invalide ou corrompu', '❌');
      }
    };
    reader.readAsText(file);
  }

  // ── Notifications ────────────────────────────────────────────
  async function handleEnableNotifications() {
    const perm = await requestNotificationPermission();
    setNotifState(perm);
    if (perm === 'granted') {
      updateSettings({ notificationsEnabled: true });
      showToast('Notifications activées', '🔔');
    } else {
      updateSettings({ notificationsEnabled: false });
      showToast('Permission refusée par le navigateur', '⚠️');
    }
  }

  function setPrice(min: number, val: string) {
    const v = parseInt(val) || 0;
    updateSettings({ prices: { ...settings.prices, [min]: v } });
    showToast('Tarif mis à jour', '💾');
  }

  function handleSoundUpload(posteId: string, file: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('Fichier trop lourd (max 2 Mo)', '⚠️', 'var(--amber)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      updateSettings({ customSounds: { ...settings.customSounds, [posteId]: dataUrl } });
      showToast(`Son personnalisé enregistré pour ${postes.find(p => p.id === posteId)?.name}`, '🔊');
    };
    reader.readAsDataURL(file);
  }

  function removeCustomSound(posteId: string) {
    const next = { ...settings.customSounds };
    delete next[posteId];
    updateSettings({ customSounds: next });
    showToast('Son supprimé', '🗑️');
  }

  function testSound(posteId: string, posteName: string) {
    if (settings.soundMuted) { showToast('Son coupé — active le son d\'abord', '🔇'); return; }
    const custom = settings.customSounds[posteId];
    if (custom) {
      playCustomSound(custom, settings.soundVolume);
    } else if (settings.voiceEnabled && isSpeechSupported()) {
      speakExpired(posteName, settings.soundVolume);
    } else {
      playAlertSound('expired', settings.soundVolume);
    }
  }

  const speechOk = isSpeechSupported();

  return (
    <div className="reglages-view">
      <div className="section-head mb-5">
        <h2 className="section-title">Réglages</h2>
      </div>

      {/* Tarifs */}
      <div className="settings-card animate-card">
        <h3 className="card-title">💰 Tarifs des sessions</h3>
        {[30, 60, 90, 120].map(d => (
          <div key={d} className="field-row">
            <label>{d === 30 ? '30 min' : d === 60 ? '1 heure' : d === 90 ? '1h30' : '2 heures'} (FCFA)</label>
            <input type="number" defaultValue={settings.prices[d] ?? 0} step="50"
              onBlur={e => setPrice(d, e.target.value)} className="field-num-input" />
          </div>
        ))}
        <div className="field-row">
          <label style={{ maxWidth: '65%' }}>
            Durées personnalisées : tarif / minute (FCFA)
            <br /><span style={{ fontSize: 11, color: 'var(--text3)' }}>Utilisé quand aucun tarif fixe ne correspond</span>
          </label>
          <input type="number" defaultValue={settings.customPricePerMinute} step="5"
            onBlur={e => {
              updateSettings({ customPricePerMinute: parseInt(e.target.value) || 0 });
              showToast('Tarif/min mis à jour', '💾');
            }} className="field-num-input" />
        </div>
      </div>

      {/* Extras */}
      <div className="settings-card animate-card">
        <h3 className="card-title">🥤 Extras</h3>
        <div className="field-row">
          <label>Prix boisson / snack (FCFA)</label>
          <input type="number" defaultValue={settings.priceDrink} step="50"
            onBlur={e => {
              updateSettings({ priceDrink: parseInt(e.target.value) || 0 });
              showToast('Prix boisson mis à jour', '💾');
            }} className="field-num-input" />
        </div>
      </div>

      {/* Salle */}
      <div className="settings-card animate-card">
        <h3 className="card-title">🕹️ Salle</h3>
        <div className="field-row">
          <label>Nombre de postes</label>
          <input type="number" min="1" max="10" defaultValue={settings.posteCount}
            onBlur={e => {
              const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
              const busy = postes.slice(v).some(p => p.status === 'busy');
              if (busy) { showToast('Impossible : un poste en session serait supprimé', '⚠️'); return; }
              updateSettings({ posteCount: v });
              showToast('Nombre de postes mis à jour', '💾');
            }} className="field-num-input" />
        </div>
        <div className="field-row">
          <label>Alerte fin de session (min avant la fin)</label>
          <input type="number" min="1" max="15" defaultValue={settings.warnMinutes}
            onBlur={e => {
              updateSettings({ warnMinutes: parseInt(e.target.value) || 5 });
              showToast('Seuil d\'alerte mis à jour', '💾');
            }} className="field-num-input" />
        </div>
      </div>

      {/* Emoji par poste */}
      <div className="settings-card animate-card">
        <h3 className="card-title">🎮 Emoji par poste</h3>
        {postes.map(p => (
          <div key={p.id} className="field-row">
            <label>{p.name}</label>
            <input type="text" maxLength={4} defaultValue={p.emoji ?? ''}
              placeholder="🎮"
              onBlur={e => {
                updatePoste(p.id, { emoji: e.target.value.trim() || null });
                showToast(`Emoji ${p.name} mis à jour`, '🎮');
              }}
              style={{ width: 60, textAlign: 'center', fontSize: 18, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px', color: 'var(--text)' }}
            />
          </div>
        ))}
        <p className="field-hint">Affiché quand le poste est libre. Vide = 🎮 par défaut.</p>
      </div>

      {/* Son des alertes */}
      <div className="settings-card animate-card">
        <h3 className="card-title">🔊 Alertes sonores</h3>

        {/* Global controls */}
        <div className="field-row">
          <label>Volume général</label>
          <input type="range" min="0" max="1" step="0.05"
            defaultValue={settings.soundVolume}
            onChange={e => updateSettings({ soundVolume: parseFloat(e.target.value) })}
            style={{ width: 130 }} />
        </div>

        <div className="field-row">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ margin: 0 }}>🗣️ Voix synthétique</label>
            <span style={{ fontSize: 11, color: speechOk ? 'var(--green)' : 'var(--red)' }}>
              {speechOk ? 'Supporté par ce navigateur' : 'Non supporté — utilise les bips'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>
              "Poste 1, il reste 5 minutes" · "Poste 1, session terminée"
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.voiceEnabled && speechOk}
              disabled={!speechOk}
              onChange={e => updateSettings({ voiceEnabled: e.target.checked })}
            />
            <span className="slider-toggle" />
          </label>
        </div>

        {!settings.voiceEnabled && (
          <div className="field-row" style={{ borderBottom: 'none' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', maxWidth: '60%' }}>
              Voix désactivée → bip synthétisé (fonctionne hors-ligne)
            </span>
            <button className="day-btn" onClick={() => playAlertSound('warning', settings.soundVolume)}>
              🔊 Tester bip
            </button>
          </div>
        )}
        {settings.voiceEnabled && speechOk && (
          <div className="field-row" style={{ borderBottom: 'none' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', maxWidth: '60%' }}>
              La voix du navigateur parle selon la langue système. Chrome / Edge recommandés.
            </span>
            <button className="day-btn" onClick={() => speakExpired('Poste 1', settings.soundVolume)}>
              🗣️ Tester voix
            </button>
          </div>
        )}
      </div>

      {/* Sons personnalisés par poste */}
      <div className="settings-card animate-card">
        <h3 className="card-title">🎵 Son personnalisé par poste</h3>
        <p className="field-hint" style={{ marginBottom: 14 }}>
          Importe un fichier audio (MP3, WAV, OGG — max 2 Mo) pour chaque poste.
          Il remplace la voix et les bips pour ce poste uniquement.
        </p>
        {postes.map(p => {
          const hasCustom = !!settings.customSounds[p.id];
          return (
            <div key={p.id} className="sound-upload-row">
              <div className="sound-upload-info">
                <span className="sound-poste-label">{p.emoji ?? '🎮'} {p.name}</span>
                {hasCustom ? (
                  <span className="sound-status-ok">✅ Son personnalisé chargé</span>
                ) : (
                  <span className="sound-status-default">
                    {settings.voiceEnabled && speechOk ? '🗣️ Voix synthétique' : '🔔 Bip'}
                  </span>
                )}
              </div>
              <div className="sound-upload-actions">
                {hasCustom && (
                  <>
                    <button className="day-btn"
                      onClick={() => playCustomSound(settings.customSounds[p.id], settings.soundVolume)}>
                      ▶ Écouter
                    </button>
                    <button className="day-btn danger"
                      onClick={() => removeCustomSound(p.id)}>
                      🗑 Suppr.
                    </button>
                  </>
                )}
                <label className="upload-label">
                  📁 Importer
                  <input
                    type="file"
                    accept="audio/*"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleSoundUpload(p.id, file);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button className="day-btn" onClick={() => testSound(p.id, p.name)}>
                  🔊 Test
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Sauvegarde & Restauration ── */}
      <div className="settings-card animate-card">
        <h3 className="card-title">💾 Sauvegarde &amp; Restauration</h3>
        <div className="field-row">
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>Exporter</label>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>
              Télécharge tickets, sessions et réglages en fichier .json
            </span>
          </div>
          <button className="day-btn primary" onClick={exportData}>⬇️ Exporter</button>
        </div>
        <div className="field-row" style={{ borderBottom: 'none' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>Restaurer</label>
            <span style={{ fontSize: 11, color: 'var(--red)' }}>
              Remplace TOUTES les données actuelles
            </span>
          </div>
          <label className="upload-label" style={{ cursor: 'pointer' }}>
            ⬆️ Importer
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {/* ── Notifications système ── */}
      <div className="settings-card animate-card">
        <h3 className="card-title">🔔 Notifications système</h3>
        <div className="field-row" style={{ borderBottom: 'none' }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13 }}>Notification navigateur à la fin d'une session</span>
            <br />
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>
              En complément du son — ne le remplace pas
            </span>
            {notifState === 'unsupported' && (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>⚠️ Non supporté par ce navigateur</div>
            )}
            {notifState === 'denied' && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>❌ Permission refusée — activez dans les paramètres du navigateur</div>
            )}
            {notifState === 'granted' && (
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>✅ Notifications autorisées</div>
            )}
          </div>
          {notifState === 'granted' ? (
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={e => updateSettings({ notificationsEnabled: e.target.checked })}
              />
              <span className="slider-toggle" />
            </label>
          ) : (
            <button
              className="day-btn primary"
              disabled={notifState === 'unsupported' || notifState === 'denied'}
              onClick={handleEnableNotifications}
            >
              Activer
            </button>
          )}
        </div>
      </div>

      {/* ── Animations (étape 3E) ── */}
      <div className="settings-card animate-card">
        <h3 className="card-title">✨ Animations</h3>
        <div className="field-row" style={{ borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13 }}>Intensité des animations d'interface</span>
            {prefersReduced && (
              <span style={{ fontSize: 11, color: 'var(--amber)' }}>
                ⚠️ Votre système force la réduction — animations désactivées quoi que vous choisissiez
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([
              ['off', '🚫 Désactivées'],
              ['subtle', '🌙 Subtiles'],
              ['normal', '✨ Normales'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                className={`day-btn ${settings.motionIntensity === val ? 'primary' : ''}`}
                onClick={() => {
                  updateSettings({ motionIntensity: val });
                  showToast(`Animations : ${label}`, '✨');
                }}
                disabled={prefersReduced}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
            Concerne le splash, les particules, l'écran power-cut, les écrans vides. Les animations système
            (transition de pages, cartes) suivent votre préférence OS.
          </span>
        </div>
      </div>

      {/* ── Langue ── */}
      <div className="settings-card animate-card">
        <h3 className="card-title">🌍 Langue de l'interface</h3>
        <div className="field-row" style={{ borderBottom: 'none' }}>
          <span style={{ fontSize: 13 }}>Choisir la langue d'affichage</span>
          <div className="lang-pill-group">
            {LOCALES.map(l => (
              <button
                key={l.value}
                className={`lang-pill ${locale === l.value ? 'active' : ''}`}
                onClick={() => setLocale(l.value)}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
