import { useState, useEffect, useRef } from 'react';
import { useStore, Poste, Ticket } from '../../store/useStore';
import { fmtTime, fmtDuration, fmtMoney, fmtMs, isTicketValid, msToMin, generateTicketCode, TICKET_VALID_MS } from '../../lib-app/helpers';
import { playAlertSound, playSessionStart, playTicketScan, speakWarning, speakExpired, playCustomSound, isSpeechSupported } from '../../lib-app/audio';
import { showToast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { fireWebNotification } from '../../lib-app/notifications';

const soundTimers = new Map<string, { lastAt: number; expiredAnnounced: boolean }>();

function fireAlert(kind: 'warning' | 'expired', posteId: string, posteName: string, minutesLeft: number, volume: number, voiceEnabled: boolean, customSounds: Record<string, string>) {
  const custom = customSounds[posteId];
  if (custom) {
    playCustomSound(custom, volume);
  } else if (voiceEnabled && isSpeechSupported()) {
    if (kind === 'expired') speakExpired(posteName, volume);
    else speakWarning(posteName, minutesLeft, volume);
  } else {
    playAlertSound(kind, volume);
  }
}

function ProgressRing({ remaining, total, warning, paused }: { remaining: number; total: number; warning: boolean; paused: boolean }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 1;
  const offset = circ * (1 - pct);
  const stroke = paused ? 'var(--text2)' : warning ? 'var(--red)' : 'var(--amber)';
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" style={{ transform: 'rotate(-90deg)' }}>
      <circle fill="none" stroke="var(--border2)" strokeWidth="8" cx="66" cy="66" r={r} />
      <circle fill="none" stroke={stroke} strokeWidth="8" strokeLinecap="round"
        cx="66" cy="66" r={r}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
      />
    </svg>
  );
}

interface ModalData {
  posteId: string;
  mode: 'new' | 'resume';
  resumeMs?: number;
  resumeTicketId?: string;
}

interface ExtendModalData {
  posteId: string;
}

interface ResumeCodeModal {
  posteId: string;
}

export function SalleView() {
  const { postes, sessions, tickets, settings, updatePoste, addSession, updateTicket, setPowerCut, powerCutActive, todayKey } = useStore();
  const [modal, setModal] = useState<ModalData | null>(null);
  const [extendModal, setExtendModal] = useState<ExtendModalData | null>(null);
  const [resumeCodeModal, setResumeCodeModal] = useState<ResumeCodeModal | null>(null);
  const [resumeCode, setResumeCode] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Sound / voice alerts
  useEffect(() => {
    if (settings.soundMuted) return;
    const now = Date.now();
    postes.forEach(p => {
      if (p.status === 'busy' && !p.paused) {
        const remaining = Math.max(0, (p.endsAt! - now) / 1000);
        const warnSec = settings.warnMinutes * 60;
        if (remaining <= warnSec) {
          const timer = soundTimers.get(p.id) ?? { lastAt: 0, expiredAnnounced: false };
          const expired = remaining <= 0;
          const minutesLeft = Math.ceil(remaining / 60);
          if (expired && !timer.expiredAnnounced) {
            fireAlert('expired', p.id, p.name, 0, settings.soundVolume, settings.voiceEnabled, settings.customSounds);
            if (settings.notificationsEnabled) fireWebNotification('expired', p.name, 0);
            timer.expiredAnnounced = true;
            timer.lastAt = now;
          } else if (!expired) {
            const interval = 20000; // re-announce every 20s during warning zone
            if (now - timer.lastAt >= interval) {
              fireAlert('warning', p.id, p.name, minutesLeft, settings.soundVolume, settings.voiceEnabled, settings.customSounds);
              if (settings.notificationsEnabled) fireWebNotification('warning', p.name, minutesLeft);
              timer.lastAt = now;
            }
          } else if (expired) {
            // already announced, repeat expired alert every 12s
            if (now - timer.lastAt >= 12000) {
              fireAlert('expired', p.id, p.name, 0, settings.soundVolume, settings.voiceEnabled, settings.customSounds);
              if (settings.notificationsEnabled) fireWebNotification('expired', p.name, 0);
              timer.lastAt = now;
            }
          }
          soundTimers.set(p.id, timer);
        } else {
          soundTimers.delete(p.id);
        }
      } else {
        soundTimers.delete(p.id);
      }
    });
  }, [tick]);

  function openNewSession(poste: Poste) {
    setModal({ posteId: poste.id, mode: 'new' });
  }

  function openResumeCode(poste: Poste) {
    setResumeCodeModal({ posteId: poste.id });
    setResumeCode('');
  }

  function handleResumeCode() {
    const code = resumeCode.trim().toUpperCase();
    const ticket = tickets.find(t => t.code === code);
    if (!ticket) {
      showToast('Code ticket introuvable', '❌', 'var(--red)');
      return;
    }
    if (!isTicketValid(ticket)) {
      showToast('Ticket expiré — reprise impossible', '⏰', 'var(--red)');
      return;
    }
    if (!ticket.savedRemainingMs || ticket.savedRemainingMs <= 0) {
      showToast('Pas de temps restant sur ce ticket', '⚠️', 'var(--amber)');
      return;
    }
    if (ticket.usedSavedTime) {
      showToast('Temps restant déjà utilisé', '⚠️', 'var(--amber)');
      return;
    }
    playTicketScan(settings.soundVolume);
    setResumeCodeModal(null);
    setModal({ posteId: resumeCodeModal!.posteId, mode: 'resume', resumeMs: ticket.savedRemainingMs, resumeTicketId: ticket.id });
  }

  function pauseSession(posteId: string) {
    const p = postes.find(x => x.id === posteId);
    if (!p || p.status !== 'busy' || p.paused) return;
    const now = Date.now();
    const remaining = Math.max(0, p.endsAt! - now);
    updatePoste(posteId, { paused: true, remainingMs: remaining });
    soundTimers.delete(posteId);
    showToast(`${p.name} en pause`, '⏸️');
  }

  function resumeSession(posteId: string) {
    const p = postes.find(x => x.id === posteId);
    if (!p || !p.paused) return;
    const now = Date.now();
    updatePoste(posteId, { paused: false, endsAt: now + (p.remainingMs ?? 0), remainingMs: null });
    showToast(`${p.name} — reprise`, '▶️');
  }

  function endSession(posteId: string) {
    const p = postes.find(x => x.id === posteId);
    if (!p) return;
    soundTimers.delete(posteId);
    // Save remaining time to the ticket so client can resume later
    if (p.ticketId) {
      const nowMs = Date.now();
      const remaining = p.paused ? (p.remainingMs ?? 0) : Math.max(0, (p.endsAt ?? nowMs) - nowMs);
      const ticket = tickets.find(t => t.id === p.ticketId);
      if (remaining > 1_000 && ticket && !ticket.usedSavedTime) {
        // Any reliquat > 1 sec → save exact ms, client can resume
        updateTicket(p.ticketId, { savedRemainingMs: remaining, usedSavedTime: false });
        showToast(`${fmtMs(remaining)} sauvegardées sur le ticket`, '⏳');
      } else {
        // temps épuisé (ou reliquat déjà utilisé) → ticket terminé
        updateTicket(p.ticketId, { savedRemainingMs: null, usedSavedTime: true });
      }
    }
    updatePoste(posteId, {
      status: 'idle', durationMin: null, startedAt: null, endsAt: null,
      paused: false, remainingMs: null, drinkCount: 0,
      ticketId: null, ticketCode: null, clientName: null,
      // RT.H.5 — reset du badge quand le poste redevient libre
      minorAuthorised: false,
    });
    showToast(`${p.name} libéré`, '🏁');
  }

  function powerCutAll() {
    const busy = postes.filter(p => p.status === 'busy' && !p.paused);
    if (busy.length === 0) { showToast('Aucune session active', '⚠️'); return; }
    if (!confirm(`Geler ${busy.length} session(s) actives ? Les temps restants seront sauvegardés sur les tickets.`)) return;
    const now = Date.now();
    busy.forEach(p => {
      const remaining = Math.max(0, p.endsAt! - now);
      updatePoste(p.id, { paused: true, remainingMs: remaining });
      if (p.ticketId) {
        updateTicket(p.ticketId, { savedRemainingMs: remaining, usedSavedTime: false });
      }
      soundTimers.delete(p.id);
    });
    // Étape 3D — déclenche l'overlay power-cut global (fige l'app app/*)
    setPowerCut(true);
    showToast(`${busy.length} session(s) gelées — temps sauvegardés`, '⚡', 'var(--amber)');
  }

  const busyCount = postes.filter(p => p.status === 'busy').length;
  const now = Date.now();

  return (
    <div className="salle-view">
      <div className="section-head flex items-baseline justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="section-title">État de la salle</h2>
          <p className="section-hint">{busyCount}/{postes.length} postes actifs · Crée un ticket client avant de lancer une session</p>
        </div>
        <button className="power-cut-btn" onClick={powerCutAll} aria-label="Geler toutes les sessions (coupure électricité)" title="Geler toutes les sessions (coupure électricité)">
          ⚡ Coupure
        </button>
      </div>

      <div className="postes-grid">
        {postes.length === 0 ? (
          <EmptyState
            variant="salle"
            icon="🎮"
            title="Aucun poste configuré"
            body="Configure le nombre de postes dans Réglages pour commencer"
          />
        ) : postes.every(p => p.status === 'idle') && !powerCutActive ? (
          <EmptyState
            variant="salle"
            icon="🎮"
            title="Aucun poste actif"
            body="Crée un ticket client puis lance une session depuis un poste libre"
          />
        ) : (
          postes.map((p, i) => {
          const isBusy = p.status === 'busy';
          const isPaused = isBusy && p.paused;
          let remaining = 0, totalSec = 1;
          let warning = false;
          if (isBusy) {
            if (isPaused) remaining = (p.remainingMs ?? 0) / 1000;
            else remaining = Math.max(0, (p.endsAt! - now) / 1000);
            // Use exact session span for ring — avoids drift from rounded durationMin
            totalSec = p.startedAt && p.endsAt ? (p.endsAt - p.startedAt) / 1000 : (p.durationMin ?? 1) * 60;
            warning = !isPaused && remaining <= settings.warnMinutes * 60;
          }

          const emoji = isPaused ? '⏸️' : (p.emoji ?? (warning ? '🔴' : isBusy ? '⏳' : '🎮'));

          return (
            <div
              key={p.id}
              className={`poste-card ${isBusy ? (isPaused ? 'paused' : (warning ? 'warning' : 'busy')) : 'idle'}`}
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              {isBusy && <div className="poste-glow" />}
              <div className="poste-top">
                <div className="poste-name-row">
                  <span className={`poste-emoji ${warning ? 'emoji-pulse' : ''}`}>{emoji}</span>
                  <span className="poste-name">{p.name}</span>
                </div>
                <span className={`status-dot ${isBusy ? (warning ? 'dot-red' : isPaused ? 'dot-pause' : 'dot-amber') : 'dot-idle'}`} />
              </div>

              <div className="ring-wrap">
                {isBusy && <ProgressRing remaining={remaining} total={totalSec} warning={warning} paused={isPaused} />}
                {!isBusy && (
                  <svg width="132" height="132" viewBox="0 0 132 132" style={{ transform: 'rotate(-90deg)' }}>
                    <circle fill="none" stroke="var(--border2)" strokeWidth="8" cx="66" cy="66" r="54" />
                  </svg>
                )}
                <div className="ring-center">
                  {isBusy ? (
                    <>
                      <div className={`ring-time ${warning ? 'text-red' : ''}`}>{fmtTime(remaining)}</div>
                      <div className="ring-sub">{isPaused ? 'en pause' : remaining <= 0 ? 'terminé' : 'restant'}</div>
                    </>
                  ) : (
                    <div className="ring-idle">Libre</div>
                  )}
                </div>
              </div>

              <div className="poste-meta">
                {isBusy ? (
                  <>
                    <span>{fmtDuration(p.durationMin ?? 0)}{p.drinkCount > 0 ? ` · 🥤×${p.drinkCount}` : ''}</span>
                    {p.clientName && <span className="client-tag">👤 {p.clientName}</span>}
                    {/* RT.H.5 — badge visuel quand staff a autorisé un client mineur */}
                    {p.minorAuthorised && (
                      <span
                        className="minor-badge"
                        title="Session autorisée par staff pour client < 16 ans"
                        aria-label="Session autorisée par staff pour client mineur"
                      >
                        🛡️ autorisé
                      </span>
                    )}
                  </>
                ) : 'Disponible'}
              </div>

              {isBusy ? (
                <div className="poste-actions">
                  {isPaused ? (
                    <button className="btn-resume" onClick={() => resumeSession(p.id)}>▶️ Reprendre</button>
                  ) : (
                    <button className="btn-pause" onClick={() => pauseSession(p.id)}>⏸️ Pause</button>
                  )}
                  <div className="btn-row">
                    <button className="btn-extend" onClick={() => setExtendModal({ posteId: p.id })}>⏱ Ajouter</button>
                    <button className="btn-stop" onClick={() => endSession(p.id)}>⏹ Terminer</button>
                  </div>
                </div>
              ) : (
                <div className="poste-actions">
                  <button className="btn-start" onClick={() => openNewSession(p)}>🎮 Lancer session</button>
                  <button className="btn-resume-code" onClick={() => openResumeCode(p)}>🎫 Code ticket</button>
                </div>
              )}
            </div>
          );
        })
        )}
      </div>

      {modal && (
        <SessionModal
          posteId={modal.posteId}
          mode={modal.mode}
          resumeMs={modal.resumeMs}
          resumeTicketId={modal.resumeTicketId}
          onClose={() => setModal(null)}
          onConfirm={(data) => {
            const p = postes.find(x => x.id === modal.posteId)!;
            const ticket = tickets.find(t => t.id === data.ticketId);
            const now2 = Date.now();
            // In resume mode use exact saved ms — never round to minutes
            const exactMs = data.resumeExactMs ?? (data.durationMin * 60 * 1000);
            updatePoste(modal.posteId, {
              status: 'busy',
              durationMin: data.durationMin,
              startedAt: now2,
              endsAt: now2 + exactMs,
              paused: false,
              remainingMs: null,
              drinkCount: data.drinkCount,
              ticketId: data.ticketId ?? null,
              ticketCode: ticket?.code ?? null,
              clientName: ticket ? `${ticket.prenom} ${ticket.nom}` : null,
              // RT.H.5 — badge visuel sur la carte poste si client < 16 autorisé par staff
              minorAuthorised: data.minorAuthorised ?? false,
            });
            if (modal.mode === 'resume' && modal.resumeTicketId) {
              // Clear saved time but do NOT mark usedSavedTime yet — that happens in endSession
              updateTicket(modal.resumeTicketId, { savedRemainingMs: null });
            }
            // RT.P.0-fix — collision d'ID évitée : on passe de 's' + Date.now()
            // (collision possible si 2 sessions créées le même ms) à crypto.randomUUID()
            // (collision négligeable, pas de nouvelle dépendance).
            const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
              ? crypto.randomUUID()
              : 's' + now2 + '-' + Math.random().toString(36).slice(2, 8);
            const dayStr = todayKey();
            addSession({
              id: sessionId,
              posteId: p.id,
              posteName: p.name,
              ts: now2,
              durationMin: data.durationMin,
              drinkCount: data.drinkCount,
              amount: data.amount,
              day: dayStr,
              ticketId: data.ticketId ?? null,
              ticketCode: ticket?.code ?? null,
              clientName: ticket ? `${ticket.prenom} ${ticket.nom}` : null,
              paymentMethod: data.paymentMethod,
              minorAuthorised: data.minorAuthorised, // RT.H.5
            });
            playSessionStart(settings.soundVolume);
            showToast(`${p.name} — ${fmtDuration(data.durationMin)} lancé${data.ticketId ? ` · ${ticket?.prenom}` : ''}`, '🎮');
            setModal(null);
          }}
        />
      )}

      {extendModal && (
        <ExtendModal
          posteId={extendModal.posteId}
          onClose={() => setExtendModal(null)}
          onConfirm={(extraMin) => {
            const p = postes.find(x => x.id === extendModal.posteId)!;
            if (p.paused) {
              updatePoste(extendModal.posteId, { remainingMs: (p.remainingMs ?? 0) + extraMin * 60 * 1000, durationMin: (p.durationMin ?? 0) + extraMin });
            } else {
              updatePoste(extendModal.posteId, { endsAt: p.endsAt! + extraMin * 60 * 1000, durationMin: (p.durationMin ?? 0) + extraMin });
            }
            soundTimers.delete(extendModal.posteId);
            showToast(`${p.name} +${extraMin} min`, '⏱️');
            setExtendModal(null);
          }}
        />
      )}

      {resumeCodeModal && (
        <div className="modal-overlay active">
          <div className="modal">
            <h3 className="modal-title">🎫 Reprendre par code ticket</h3>
            <p className="modal-sub">{postes.find(x => x.id === resumeCodeModal.posteId)?.name}</p>
            <input
              autoFocus
              type="text"
              value={resumeCode}
              onChange={e => setResumeCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleResumeCode()}
              placeholder="Code ticket (ex: AB3KF72)"
              className="code-input"
              maxLength={8}
              style={{ fontFamily: 'Oswald, monospace', letterSpacing: '2px', textTransform: 'uppercase' }}
            />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setResumeCodeModal(null)}>Annuler</button>
              <button className="btn-confirm" onClick={handleResumeCode}>Reprendre ▶</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface SessionConfirmData {
  durationMin: number;
  drinkCount: number;
  amount: number;
  ticketId?: string;
  resumeExactMs?: number; // exact milliseconds for resume — never rounded
  paymentMethod: 'cash' | 'airtel_money' | 'mtn_money';
  minorAuthorised?: boolean; // RT.H.5 — flag si staff a autorisé un client < 16
}

function SessionModal({ posteId, mode, resumeMs, resumeTicketId, onClose, onConfirm }: {
  posteId: string;
  mode: 'new' | 'resume';
  resumeMs?: number;
  resumeTicketId?: string;
  onClose: () => void;
  onConfirm: (d: SessionConfirmData) => void;
}) {
  const { postes, tickets, settings } = useStore();
  const poste = postes.find(p => p.id === posteId)!;
  const now = Date.now();
  const validTickets = tickets.filter(t => isTicketValid(t));
  const resumeTicket = resumeTicketId ? tickets.find(t => t.id === resumeTicketId) : null;

  const presetDurations = [30, 60, 90, 120];
  const [selectedDuration, setSelectedDuration] = useState<number | null>(
    mode === 'resume' && resumeMs ? msToMin(resumeMs) : null
  );
  const [customMin, setCustomMin] = useState('');
  const [drinkCount, setDrinkCount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'airtel_money' | 'mtn_money'>('cash');
  const [selectedTicketId, setSelectedTicketId] = useState<string>(resumeTicketId ?? '');
  const [ticketSearch, setTicketSearch] = useState(resumeTicket ? `${resumeTicket.prenom} ${resumeTicket.nom}` : '');
  const [showTicketList, setShowTicketList] = useState(false);
  // RT.H.5 — Confirmation intermédiaire si client mineur (âge < 16)
  const [pendingMinorConfirm, setPendingMinorConfirm] = useState(false);

  const isResume = mode === 'resume';
  const resumeMinutes = resumeMs ? msToMin(resumeMs) : 0;

  const finalDuration = selectedDuration ?? (customMin ? parseInt(customMin) || 0 : 0);
  // In resume mode the time was already paid — only the drink (if any) is charged
  const price = isResume ? 0 : (settings.prices[finalDuration] ?? Math.round(finalDuration * settings.customPricePerMinute));
  const total = price + drinkCount * settings.priceDrink;

  const selectedTicket = validTickets.find(t => t.id === selectedTicketId);
  const filteredTickets = validTickets.filter(t =>
    `${t.prenom} ${t.nom} ${t.code}`.toLowerCase().includes(ticketSearch.toLowerCase())
  );

  function canConfirm() {
    if (!selectedTicketId) return false;
    if (finalDuration < 1) return false;
    if (isResume) return true;
    if (finalDuration < 30) return false;
    return true;
  }

  function handleConfirm() {
    if (!canConfirm()) {
      if (!selectedTicketId) showToast('Sélectionne un ticket client', '⚠️', 'var(--amber)');
      else if (finalDuration < 30) showToast('Durée minimum 30 min', '⚠️', 'var(--amber)');
      else showToast('Sélectionne une durée', '⚠️', 'var(--amber)');
      return;
    }
    // RT.H.5 — Si client mineur (âge < 16) et pas encore confirmé, on demande l'autorisation staff
    if (selectedTicket && selectedTicket.age < 16 && !pendingMinorConfirm) {
      setPendingMinorConfirm(true);
      return;
    }
    onConfirm({
      durationMin: finalDuration,
      drinkCount,
      amount: total,
      ticketId: selectedTicketId || undefined,
      resumeExactMs: isResume && resumeMs ? resumeMs : undefined,
      paymentMethod: selectedTicket && selectedTicket.age < 16 ? 'cash' : paymentMethod, // RT.H.5 mineurs toujours en cash
    });
  }

  function handleMinorAuthorise() {
    // RT.H.5 — Confirmation explicite du staff
    if (!selectedTicket) return;
    showToast(`⚠️ Session autorisée par staff pour ${selectedTicket.prenom} (${selectedTicket.age} ans)`, '🛡️', 'var(--amber)');
    setPendingMinorConfirm(false);
    onConfirm({
      durationMin: finalDuration,
      drinkCount,
      amount: total,
      ticketId: selectedTicketId || undefined,
      resumeExactMs: isResume && resumeMs ? resumeMs : undefined,
      paymentMethod: 'cash',
      minorAuthorised: true, // RT.H.5 — flag trace
    });
  }

  function handleMinorCancel() {
    setPendingMinorConfirm(false);
  }

  return (
    <div className="modal-overlay active">
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{isResume ? '▶️ Reprendre session' : '🎮 Nouvelle session'}</h3>
            <p className="modal-sub">{poste.name}{isResume && resumeMs ? ` · ${fmtMs(resumeMs)} restant` : ''}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {/* Ticket selector */}
        <div className="field-section">
          <label className="field-label">👤 Client (ticket requis)</label>
          {isResume && resumeTicket ? (
            <div className="ticket-chip selected">
              🎫 {resumeTicket.prenom} {resumeTicket.nom} — <span className="code-text">{resumeTicket.code}</span>
            </div>
          ) : (
            <>
              <div className="ticket-search-wrap">
                <input
                  type="text"
                  value={ticketSearch}
                  onChange={e => { setTicketSearch(e.target.value); setShowTicketList(true); setSelectedTicketId(''); }}
                  onFocus={() => setShowTicketList(true)}
                  placeholder="Recherche par nom ou code…"
                  className="ticket-search-input"
                />
                {selectedTicket && <div className="ticket-chip selected" style={{ marginTop: 8 }}>
                  ✅ {selectedTicket.prenom} {selectedTicket.nom} — <span className="code-text">{selectedTicket.code}</span>
                </div>}
              </div>
              {showTicketList && filteredTickets.length > 0 && (
                <div className="ticket-dropdown">
                  {filteredTickets.slice(0, 6).map(t => (
                    <button key={t.id} className="ticket-option" onClick={() => {
                      setSelectedTicketId(t.id);
                      setTicketSearch(`${t.prenom} ${t.nom}`);
                      setShowTicketList(false);
                    }}>
                      <span className="code-text">{t.code}</span>
                      <span>{t.prenom} {t.nom}</span>
                      <span className="text-mute">{t.age} ans</span>
                    </button>
                  ))}
                </div>
              )}
              {validTickets.length === 0 && (
                <p className="field-hint" style={{ color: 'var(--red)' }}>⚠️ Aucun ticket valide — crée d'abord un ticket dans l'onglet Tickets</p>
              )}
            </>
          )}
        </div>

        {/* RT.H.5 — Bandeau d'alerte + boutons d'autorisation pour client mineur (< 16 ans) */}
        {pendingMinorConfirm && selectedTicket && selectedTicket.age < 16 && (
          <div className="minor-confirm-banner" role="alert" aria-live="polite">
            <div className="minor-confirm-icon" aria-hidden="true">⚠️</div>
            <div className="minor-confirm-body">
              <div className="minor-confirm-title">
                Client mineur : {selectedTicket.prenom} {selectedTicket.nom} ({selectedTicket.age} ans)
              </div>
              <div className="minor-confirm-sub">
                Le client a moins de 16 ans. Confirmez explicitement l'autorisation
                du staff pour lancer la session (paiement en espèces uniquement).
              </div>
              <div className="minor-confirm-actions">
                <button
                  type="button"
                  className="btn-minor-authorise"
                  onClick={handleMinorAuthorise}
                  aria-label="Autoriser la session pour le client mineur"
                >
                  ✅ Autoriser
                </button>
                <button
                  type="button"
                  className="btn-minor-cancel"
                  onClick={handleMinorCancel}
                  aria-label="Refuser et revenir au formulaire"
                >
                  ✕ Refuser
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Duration */}
        {!isResume && (
          <div className="field-section">
            <label className="field-label">⏱ Durée (min 30 min)</label>
            <div className="duration-grid">
              {presetDurations.map(d => (
                <button key={d}
                  className={`duration-btn ${selectedDuration === d ? 'selected' : ''}`}
                  onClick={() => { setSelectedDuration(d); setCustomMin(''); }}
                >
                  <span className="d-label">{fmtDuration(d)}</span>
                  <span className="d-price">{fmtMoney(settings.prices[d] ?? d * settings.customPricePerMinute)}</span>
                </button>
              ))}
            </div>
            <div className="custom-duration-row">
              <label className="field-label" style={{ marginBottom: 0 }}>Durée personnalisée (min)</label>
              <input
                type="number"
                min="30"
                step="5"
                value={customMin}
                onChange={e => { setCustomMin(e.target.value); setSelectedDuration(null); }}
                placeholder="ex: 45"
                className="custom-input"
              />
            </div>
            {customMin && parseInt(customMin) > 0 && parseInt(customMin) < 30 && (
              <p className="field-hint" style={{ color: 'var(--red)' }}>⚠️ Minimum 30 minutes pour une nouvelle session</p>
            )}
          </div>
        )}

        {isResume && (
          <div className="resume-banner">
            <span className="resume-icon">⏳</span>
            <div>
              <div className="resume-title">{fmtTime(resumeMinutes * 60)} à récupérer</div>
              <div className="resume-sub">Temps sauvegardé sur le ticket client</div>
            </div>
          </div>
        )}

        {/* Drinks spinner */}
        <div className="drink-spinner-row">
          <span className="drink-spinner-label">🥤 Boissons</span>
          <div className="drink-spinner">
            <button className="spin-btn" onClick={() => setDrinkCount(c => Math.max(0, c - 1))} disabled={drinkCount === 0}>−</button>
            <span className="spin-val">{drinkCount}</span>
            <button className="spin-btn" onClick={() => setDrinkCount(c => Math.min(10, c + 1))}>+</button>
          </div>
          {drinkCount > 0 && (
            <span className="drink-sub">+{fmtMoney(drinkCount * settings.priceDrink)}</span>
          )}
        </div>

        {/* Payment method */}
        <div className="payment-method-row">
          <span className="payment-method-label">💳 Mode de paiement</span>
          <div className="payment-method-btns">
            {([
              ['cash', '💵 Espèces'],
              ['airtel_money', '📱 Airtel'],
              ['mtn_money', '📱 MTN'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                className={`pay-btn ${paymentMethod === val ? 'active' : ''}`}
                onClick={() => setPaymentMethod(val)}
              >{label}</button>
            ))}
          </div>
        </div>

        {/* Total */}
        <div className="modal-total">
          <span className="t-label">Total à encaisser</span>
          <span className="t-value">{fmtMoney(total)}</span>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Annuler</button>
          <button className={`btn-confirm ${!canConfirm() ? 'disabled' : ''}`} onClick={handleConfirm}>
            {isResume ? '▶️ Reprendre' : '🎮 Lancer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExtendModal({ posteId, onClose, onConfirm }: {
  posteId: string;
  onClose: () => void;
  onConfirm: (min: number) => void;
}) {
  const { postes, settings } = useStore();
  const p = postes.find(x => x.id === posteId)!;
  const [extraMin, setExtraMin] = useState<number | null>(null);
  const [customMin, setCustomMin] = useState('');

  const now = Date.now();
  const remainingMs = p.paused ? (p.remainingMs ?? 0) : Math.max(0, p.endsAt! - now);
  const remainingMin = msToMin(remainingMs);

  const presets = [15, 30, 60, 90];

  const chosen = extraMin ?? (customMin ? parseInt(customMin) || 0 : 0);
  const price = settings.prices[chosen] ?? Math.round(chosen * settings.customPricePerMinute);
  const isUnder30 = chosen > 0 && chosen < 30;
  const isRemainder = remainingMin < 30 && chosen === remainingMin;

  function handleConfirm() {
    if (chosen < 1) { showToast('Sélectionne une durée', '⚠️'); return; }
    if (chosen < 30 && !isRemainder) {
      showToast('Min 30 min sauf si c\'est le reliquat restant', '⚠️', 'var(--amber)');
      return;
    }
    onConfirm(chosen);
  }

  return (
    <div className="modal-overlay active">
      <div className="modal">
        <h3 className="modal-title">⏱ Ajouter du temps — {p.name}</h3>
        <p className="modal-sub">{fmtTime(remainingMin * 60)} restant actuellement</p>

        {remainingMin < 30 && (
          <div className="resume-banner" style={{ marginBottom: 12 }}>
            <span>⚠️</span>
            <div>
              <div className="resume-title">Reliquat : {remainingMin} min</div>
              <div className="resume-sub">Durée inférieure à 30 min autorisée uniquement pour le reliquat</div>
            </div>
          </div>
        )}

        <div className="duration-grid" style={{ marginBottom: 12 }}>
          {presets.map(d => (
            <button key={d}
              className={`duration-btn ${extraMin === d ? 'selected' : ''}`}
              onClick={() => { setExtraMin(d); setCustomMin(''); }}
            >
              <span className="d-label">+{fmtDuration(d)}</span>
              <span className="d-price">{fmtMoney(settings.prices[d] ?? d * settings.customPricePerMinute)}</span>
            </button>
          ))}
        </div>

        <div className="custom-duration-row">
          <label className="field-label" style={{ marginBottom: 0 }}>Durée personnalisée (min)</label>
          <input
            type="number"
            min="1"
            step="5"
            value={customMin}
            onChange={e => { setCustomMin(e.target.value); setExtraMin(null); }}
            placeholder="ex: 45"
            className="custom-input"
          />
        </div>

        {isUnder30 && !isRemainder && (
          <p className="field-hint" style={{ color: 'var(--red)' }}>⚠️ Minimum 30 min sauf pour le reliquat ticket</p>
        )}

        {chosen > 0 && (
          <div className="modal-total" style={{ marginTop: 12 }}>
            <span className="t-label">+{chosen} min — supplément</span>
            <span className="t-value">{fmtMoney(price)}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Annuler</button>
          <button className="btn-confirm" onClick={handleConfirm}>Confirmer ✓</button>
        </div>
      </div>
    </div>
  );
}
