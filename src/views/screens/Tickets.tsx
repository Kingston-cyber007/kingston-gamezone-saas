import { useState, useRef, useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { useStore, Ticket, Session, Settings } from '../../store/useStore';
import { generateTicketCode, TICKET_VALID_MS, isTicketValid, ticketStatus, fmtDate, fmtDateTime, fmtMoney, fmtDuration, fmtMs } from '../../lib-app/helpers';
import { showToast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { playTicketScan } from '../../lib-app/audio';
import QRCode from 'react-qr-code';
import { QRScannerModal } from './QRScannerModal';

/**
 * RT.A.4 — Helper d'aide au diagnostic localhost vs IP.
 * Si l'origine est localhost, l'OAuth et les liens d'invitation ne fonctionnent
 * que depuis la machine du gérant. On affiche un warning en console + UI.
 */
function warnIfLocalhostOrigin() {
  if (typeof window === 'undefined') return false;
  const o = window.location.origin;
  const isLocal = o.includes('localhost') || o.includes('127.0.0.1');
  if (isLocal) {
    // Pas une erreur — un dev local est valide. Mais on aide l'utilisateur à
    // comprendre pourquoi un lien généré ici ne sera pas cliquable par un
    // client tiers.
    console.warn(
      '[KG] window.location.origin =', o,
      '— Les liens d\'invitation générés ici ne fonctionneront que sur ta machine. ' +
      'Pour partager un lien avec un client/collègue, ouvre l\'app via ton IP LAN ' +
      '(ex: http://192.168.1.163:8081) et ajoute cette URL aux ' +
      '"Redirect URLs" Supabase (Authentication → URL Configuration).'
    );
  }
  return isLocal;
}

function printTicket(ticket: Ticket, sessions: Session[], settings: Settings) {
  warnIfLocalhostOrigin();
  const valid = isTicketValid(ticket);
  const ticketSessions = sessions.filter(s => s.ticketId === ticket.id);
  // RT.A.3 — QR code dans le PDF : on rend le <svg> QRCode en string via
  // renderToString côté React, puis on l'injecte dans le template HTML.
  // C'est react-qr-code qui est utilisé ailleurs (ligne ~359), aucune
  // nouvelle dépendance. Le SVG s'imprimera comme un qr code net.
  const qrSvg = renderToString(
    <QRCode
      value={ticket.code}
      size={128}
      bgColor="#FFFFFF"
      fgColor="#11141A"
      level="M"
      title={`Ticket ${ticket.code}`}
    />
  );
  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket Kingston Gaming — ${ticket.code}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f5f5f5;
    color: #1a1a1a;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 24px 16px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ticket {
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    background: #fff;
    border: 2px solid #E8A33D;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }
  .ticket-header { background: #11141A; color: #fff; padding: 20px 24px; text-align: center; min-height: 92px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .kg-logo { font-family: 'Oswald', 'Impact', sans-serif; font-size: 26px; font-weight: 700; color: #E8A33D; letter-spacing: 1px; line-height: 1.1; white-space: nowrap; }
  .kg-sub { font-size: 11px; color: #9098A8; margin-top: 4px; letter-spacing: 2px; text-transform: uppercase; white-space: nowrap; }
  .ticket-body { padding: 20px 22px; }
  .ticket-code-box { background: #11141A; border-radius: 12px; padding: 14px 12px; text-align: center; margin-bottom: 18px; height: 82px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
  .ticket-code-label { font-size: 10px; color: #9098A8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
  .ticket-code { font-family: 'Oswald', 'Impact', sans-serif; font-size: 28px; font-weight: 700; color: #E8A33D; letter-spacing: 4px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .info-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eee; font-size: 13px; }
  .info-row:last-of-type { border-bottom: none; }
  .info-label { color: #666; flex-shrink: 0; }
  .info-value { font-weight: 600; text-align: right; word-break: break-word; }
  .status-wrap { text-align: center; margin-top: 14px; }
  .status-badge { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; background: ${valid ? '#dcfce7' : '#fee2e2'}; color: ${valid ? '#166534' : '#991b1b'}; }
  .qr-wrap { display: flex; justify-content: center; align-items: center; margin: 16px auto 4px; padding: 10px; background: #fff; border: 1px solid #eee; border-radius: 12px; width: 148px; height: 148px; }
  .qr-wrap svg { width: 128px; height: 128px; display: block; }
  .qr-caption { text-align: center; font-size: 10px; color: #999; margin-top: 6px; letter-spacing: 0.5px; }
  .sessions-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid #eee; }
  .sessions-title { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; text-align: center; }
  .session-row { display: grid; grid-template-columns: 1.4fr 1fr 0.9fr 1fr; gap: 6px; font-size: 11px; color: #444; padding: 5px 0; border-bottom: 1px dotted #eee; }
  .session-row:last-child { border-bottom: none; }
  .session-row span:nth-child(3), .session-row span:nth-child(4) { text-align: right; }
  .remaining-box { background: #fff7ed; border: 1px solid #E8A33D; border-radius: 8px; padding: 12px; margin-top: 12px; text-align: center; font-size: 13px; font-weight: 600; color: #92400e; }
  .footer { text-align: center; font-size: 10px; color: #999; padding: 12px 24px; background: #f9f9f9; border-top: 1px dashed #ddd; }
  @media print {
    body { background: #fff; padding: 0; display: block; }
    .ticket { box-shadow: none; margin: 0 auto; page-break-inside: avoid; }
  }
  @media screen and (max-width: 420px) {
    body { padding: 12px 8px; }
    .ticket-body { padding: 16px; }
    .ticket-code { font-size: 24px; letter-spacing: 3px; }
  }
</style>
</head>
<body>
<div class="ticket">
  <div class="ticket-header">
    <div class="kg-logo">KINGSTON GAMING</div>
    <div class="kg-sub">Caisse · Pointe-Noire</div>
  </div>
  <div class="ticket-body">
    <div class="ticket-code-box">
      <div class="ticket-code-label">Code client</div>
      <div class="ticket-code">${ticket.code}</div>
    </div>
    <div class="qr-wrap" aria-label="QR code du ticket">${qrSvg}</div>
    <div class="qr-caption">Scanner pour valider le ticket</div>
    <div class="info-row"><span class="info-label">Client</span><span class="info-value">${ticket.prenom} ${ticket.nom}</span></div>
    <div class="info-row"><span class="info-label">Âge</span><span class="info-value">${ticket.age} ans</span></div>
    <div class="info-row"><span class="info-label">Créé le</span><span class="info-value">${fmtDateTime(ticket.dateCreation)}</span></div>
    <div class="info-row"><span class="info-label">Expire le</span><span class="info-value">${fmtDate(ticket.dateExpiration)}</span></div>
    <div class="info-row"><span class="info-label">Sessions</span><span class="info-value">${ticket.sessionIds.length} session(s)</span></div>
    <div class="info-row"><span class="info-label">Temps joué</span><span class="info-value">${fmtDuration(ticket.totalMinutesPlayed)}</span></div>
    <div class="info-row"><span class="info-label">Montant total</span><span class="info-value">${fmtMoney(ticket.totalAmount)}</span></div>
    <div class="status-wrap"><span class="status-badge">${valid ? '✅ Valide' : '❌ Expiré'}</span></div>
    ${ticket.savedRemainingMs && !ticket.usedSavedTime ? `
    <div class="remaining-box">
      ⏳ Temps restant sauvegardé : ${fmtMs(ticket.savedRemainingMs)}
      <br><small style="font-size:10px;font-weight:400;">Présenter ce ticket pour reprendre la session</small>
    </div>` : ''}
    ${ticketSessions.length > 0 ? `
    <div class="sessions-section">
      <div class="sessions-title">Historique des sessions</div>
      ${ticketSessions.map(s => `
        <div class="session-row">
          <span>${new Date(s.ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
          <span>${s.posteName}</span>
          <span>${fmtDuration(s.durationMin)}</span>
          <span>${fmtMoney(s.amount)}</span>
        </div>
      `).join('')}
    </div>` : ''}
  </div>
  <div class="footer">Kingston Gaming · Ticket confidentiel · Conservez ce document</div>
</div>
<script>window.onload = function() { setTimeout(function(){ window.print(); }, 250); }</script>
</body>
</html>`;
  const win = window.open('', '_blank');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}

export function TicketsView() {
  const { tickets, sessions, settings, addTicket, updateTicket } = useStore();
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [age, setAge] = useState('');
  const [search, setSearch] = useState('');
  const [viewTicket, setViewTicket] = useState<Ticket | null>(null);
  const [creating, setCreating] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [originWarning, setOriginWarning] = useState(false);
  const prenomRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);

  // RT.A.4 — avertir si on tourne sur localhost (info utile pour les liens d'invitation)
  useEffect(() => {
    if (warnIfLocalhostOrigin()) setOriginWarning(true);
  }, []);

  const now = Date.now();
  const validCodes = tickets.filter(t => t.dateExpiration > now).map(t => t.code);

  function handleCreate() {
    const n = nom.trim();
    const p = prenom.trim();
    const a = parseInt(age);
    if (!n || !p) { showToast('Nom et prénom requis', '⚠️', 'var(--amber)'); return; }
    if (!a || a < 1 || a > 120) { showToast('Âge invalide', '⚠️', 'var(--amber)'); return; }
    setCreating(true);
    const code = generateTicketCode(validCodes);
    const ts = Date.now();
    const ticket: Ticket = {
      // RT.P.0-fix — collision d'ID évitée : on passe de 't' + Date.now()
      // (collision possible si 2 tickets créés le même ms) à crypto.randomUUID()
      // (collision négligeable, pas de nouvelle dépendance).
      id: (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 't' + ts + '-' + Math.random().toString(36).slice(2, 8),
      nom: n, prenom: p, age: a,
      code,
      dateCreation: ts,
      dateExpiration: ts + TICKET_VALID_MS,
      savedRemainingMs: null,
      usedSavedTime: false,
      totalMinutesPlayed: 0,
      totalAmount: 0,
      sessionIds: [],
    };
    addTicket(ticket);
    playTicketScan(settings.soundVolume);
    showToast(`Ticket créé — code ${code}`, '🎫', 'var(--amber)');
    setNom(''); setPrenom(''); setAge('');
    setCreating(false);
    setViewTicket(ticket);
  }

  const filtered = tickets
    .filter(t => {
      const q = search.toLowerCase();
      return !q || `${t.prenom} ${t.nom} ${t.code}`.toLowerCase().includes(q);
    })
    .slice()
    .reverse();

  const validCount = tickets.filter(t => isTicketValid(t)).length;
  const exhaustedCount = tickets.filter(t => t.usedSavedTime).length;
  const expiredCount = tickets.filter(t => !t.usedSavedTime && !isTicketValid(t)).length;

  return (
    <div className="tickets-view">
      <div className="section-head flex items-baseline justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="section-title">Tickets clients</h2>
          <p className="section-hint">
            {validCount} valide{validCount !== 1 ? 's' : ''}
            {exhaustedCount > 0 ? ` · ${exhaustedCount} terminé${exhaustedCount !== 1 ? 's' : ''}` : ''}
            {expiredCount > 0 ? ` · ${expiredCount} expiré${expiredCount !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>

      {/* RT.A.4 — Bandeau d'avertissement localhost */}
      {originWarning && (
        <div className="kg-origin-warning" role="status">
          <strong>⚠️ Tu testes sur localhost.</strong>
          <span>
            {' '}Les liens d'invitation générés ici ne fonctionneront que sur ta machine.
            Pour tester depuis un autre appareil ou partager avec un collègue,
            ouvre l'app via ton IP LAN (ex: <code>http://192.168.1.163:8081</code>) et
            ajoute cette URL aux <em>Redirect URLs</em> Supabase
            (Authentication → URL Configuration).
          </span>
        </div>
      )}

      {/* Create form */}
      <div className="settings-card mb-6 animate-card">
        <h3 className="card-title">🎫 Nouveau ticket client</h3>
        <div className="form-grid">
          <div className="form-field">
            <label>Prénom</label>
            <input ref={prenomRef} type="text" value={prenom} onChange={e => setPrenom(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ageRef.current?.focus()}
              placeholder="Prénom du client" className="field-input" />
          </div>
          <div className="form-field">
            <label>Nom</label>
            <input type="text" value={nom} onChange={e => setNom(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ageRef.current?.focus()}
              placeholder="Nom de famille" className="field-input" />
          </div>
          <div className="form-field">
            <label>Âge</label>
            <input ref={ageRef} type="number" value={age} onChange={e => setAge(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              min="1" max="120" placeholder="Âge" className="field-input" style={{ maxWidth: 120 }} />
          </div>
          <div className="form-field" style={{ alignSelf: 'flex-end' }}>
            <button onClick={handleCreate} disabled={creating} className="btn-create-ticket">
              🎫 Créer le ticket
            </button>
          </div>
        </div>
        <p className="field-hint">Code généré automatiquement · Valable 7 jours · Minimum 30 min par session</p>
      </div>

      {/* Search + Scanner */}
      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Recherche par nom, prénom ou code…"
          className="search-input" />
        {search && <button className="search-clear" onClick={() => setSearch('')} aria-label="Effacer la recherche">✕</button>}
        <button className="scan-trigger-btn" onClick={() => setShowScanner(true)} aria-label="Scanner un QR code" title="Scanner un QR code">📷</button>
      </div>

      {/* Tickets list */}
      {filtered.length === 0 ? (
        <EmptyState
          variant="tickets"
          icon="🎫"
          title={search ? 'Aucun ticket trouvé' : 'Aucun ticket pour l\'instant'}
          body={search ? undefined : 'Crée le premier ticket client via le formulaire ci-dessus'}
        />
      ) : (
        <div className="tickets-list">
          {filtered.map((t, i) => {
            const status = ticketStatus(t);
            const ticketSessions = sessions.filter(s => s.ticketId === t.id);
            const hasRemaining = !!t.savedRemainingMs && !t.usedSavedTime;
            const badgeClass = status === 'valid' ? 'valid' : status === 'exhausted' ? 'exhausted' : 'expired';
            const badgeLabel = status === 'valid' ? '✅ Valide' : status === 'exhausted' ? '🏁 Terminé' : '❌ Expiré';
            return (
              <div key={t.id} className={`ticket-card ${status === 'valid' ? 'valid' : 'expired'}`}
                style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}>
                <div className="ticket-card-left">
                  <div className="ticket-card-code">{t.code}</div>
                  <div className="ticket-card-name">{t.prenom} {t.nom}</div>
                  <div className="ticket-card-meta">{t.age} ans · Créé {fmtDate(t.dateCreation)} · Expire {fmtDate(t.dateExpiration)}</div>
                  {hasRemaining && (
                    <div className="remaining-badge">
                      ⏳ {Math.floor(t.savedRemainingMs! / 60000)} min restantes (sauvegardées)
                    </div>
                  )}
                  <div className="ticket-card-stats">
                    <span>{ticketSessions.length} session{ticketSessions.length !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{fmtDuration(t.totalMinutesPlayed)} joué</span>
                    <span>·</span>
                    <span>{fmtMoney(t.totalAmount)}</span>
                  </div>
                </div>
                <div className="ticket-card-right">
                  <span className={`ticket-badge ${badgeClass}`}>{badgeLabel}</span>
                  <div className="ticket-card-actions">
                    <button className="btn-view-ticket" onClick={() => setViewTicket(t)}>👁 Voir</button>
                    <button className="btn-print-ticket" onClick={() => printTicket(t, sessions, settings)}>🖨 PDF</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ticket detail modal */}
      {viewTicket && (
        <TicketDetailModal
          ticket={viewTicket}
          sessions={sessions.filter(s => s.ticketId === viewTicket.id)}
          onClose={() => setViewTicket(null)}
          onPrint={() => printTicket(viewTicket, sessions, settings)}
        />
      )}

      {/* QR Scanner modal */}
      {showScanner && (
        <QRScannerModal
          onScan={(code) => {
            setSearch(code);
            setShowScanner(false);
            playTicketScan(settings.soundVolume);
            showToast(`Code scanné : ${code}`, '📷');
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}

function TicketDetailModal({ ticket, sessions, onClose, onPrint }: {
  ticket: Ticket;
  sessions: Session[];
  onClose: () => void;
  onPrint: () => void;
}) {
  const status = ticketStatus(ticket);
  const hasRemaining = !!ticket.savedRemainingMs && !ticket.usedSavedTime;
  const initials = (ticket.prenom[0] ?? '') + (ticket.nom[0] ?? '');

  // ── Stats ──────────────────────────────────────────────
  const totalPaid = sessions.reduce((s, r) => s + r.amount, 0);
  const drinksCount = sessions.reduce((sum, s) => sum + (s.drinkCount ?? 0), 0);

  // Poste le plus fréquenté
  const posteFreq: Record<string, number> = {};
  sessions.forEach(s => { posteFreq[s.posteName] = (posteFreq[s.posteName] ?? 0) + 1; });
  const favPoste = Object.entries(posteFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  // Sessions groupées par jour
  const byDay: Record<string, typeof sessions> = {};
  sessions.slice().sort((a, b) => a.ts - b.ts).forEach(s => {
    const d = new Date(s.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    (byDay[d] = byDay[d] ?? []).push(s);
  });
  const days = Object.entries(byDay).reverse(); // most recent first

  const remainMinutes = ticket.savedRemainingMs ? Math.floor(ticket.savedRemainingMs / 60000) : 0;
  const remainSeconds = ticket.savedRemainingMs ? Math.round((ticket.savedRemainingMs % 60000) / 1000) : 0;

  return (
    <div className="modal-overlay active">
      <div className="modal modal-fiche">
        {/* ── Header ── */}
        <div className="fiche-header">
          <div className="fiche-avatar">{initials.toUpperCase()}</div>
          <div className="fiche-header-info">
            <div className="fiche-name">{ticket.prenom} {ticket.nom}</div>
            <div className="fiche-meta">{ticket.age} ans · {fmtDate(ticket.dateCreation)}</div>
            <span className={`ticket-badge ${status === 'valid' ? 'valid' : status === 'exhausted' ? 'exhausted' : 'expired'}`}>
              {status === 'valid' ? '✅ Valide' : status === 'exhausted' ? '🏁 Terminé' : '❌ Expiré'}
            </span>
          </div>
          <div className="fiche-code-block">
            <div className="fiche-code-label">Code</div>
            <div className="fiche-code">{ticket.code}</div>
            <div className="fiche-qr">
              <QRCode value={ticket.code} size={72} />
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {/* ── KPI strip ── */}
        <div className="fiche-kpis">
          <div className="fiche-kpi">
            <div className="fk-value">{sessions.length}</div>
            <div className="fk-label">Session{sessions.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="fiche-kpi">
            <div className="fk-value">{fmtDuration(ticket.totalMinutesPlayed)}</div>
            <div className="fk-label">Temps joué</div>
          </div>
          <div className="fiche-kpi amber">
            <div className="fk-value">{fmtMoney(totalPaid)}</div>
            <div className="fk-label">Total payé</div>
          </div>
          <div className="fiche-kpi">
            <div className="fk-value">{drinksCount > 0 ? `🥤 ${drinksCount}` : '—'}</div>
            <div className="fk-label">Boisson{drinksCount !== 1 ? 's' : ''}</div>
          </div>
          <div className="fiche-kpi">
            <div className="fk-value" style={{ fontSize: 13 }}>{favPoste}</div>
            <div className="fk-label">Poste favori</div>
          </div>
        </div>

        {/* ── Temps restant sauvegardé ── */}
        {hasRemaining && (
          <div className="fiche-remaining">
            <span className="fiche-remaining-icon">⏳</span>
            <div>
              <div className="fiche-remaining-title">{remainMinutes} min {remainSeconds > 0 ? `${remainSeconds} sec` : ''} restantes</div>
              <div className="fiche-remaining-sub">Sauvegardées — le client peut reprendre sur n'importe quel poste</div>
            </div>
          </div>
        )}

        {/* ── Historique par jour ── */}
        <div className="fiche-history">
          {days.length === 0 ? (
            <div className="fiche-empty">Aucune session enregistrée sur ce ticket</div>
          ) : (
            days.map(([day, daySessions]) => {
              const dayTotal = daySessions.reduce((s, r) => s + r.amount, 0);
              const dayMin = daySessions.reduce((s, r) => s + r.durationMin, 0);
              return (
                <div key={day} className="fiche-day">
                  <div className="fiche-day-head">
                    <span className="fiche-day-label">{day}</span>
                    <span className="fiche-day-totals">{fmtDuration(dayMin)} · {fmtMoney(dayTotal)}</span>
                  </div>
                  {daySessions.map(s => (
                    <div key={s.id} className="fiche-session-row">
                      <span className="fsr-time">{new Date(s.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="fsr-poste">{s.posteName}</span>
                      <span className="fsr-dur">{fmtDuration(s.durationMin)}</span>
                      {s.drinkCount > 0 ? <span className="fsr-drink">🥤×{s.drinkCount}</span> : null}
                      <span className="fsr-amount">{s.amount > 0 ? fmtMoney(s.amount) : <span className="fsr-free">Reprise gratuite</span>}</span>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* ── Footer ── */}
        <div className="fiche-footer">
          <div className="fiche-expire-info">Expire le {fmtDate(ticket.dateExpiration)}</div>
          <div className="fiche-actions">
            <button className="btn-cancel" onClick={onClose}>Fermer</button>
            <button className="btn-confirm" onClick={onPrint}>🖨 PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}
