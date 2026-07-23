import { useStore } from '../store/useStore';
import { fmtMoney, fmtDuration, todayKey } from '../lib/helpers';
import { showToast } from '../components/Toast';

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="kpi-card animate-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: color ?? '#E8A33D' }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function CaisseView() {
  const { sessions, postes, settings, clearTodaySessions } = useStore();
  const today = todayKey();
  const todaySessions = sessions.filter(s => s.day === today);

  const revenue = todaySessions.reduce((sum, s) => sum + s.amount, 0);
  const extrasCount = todaySessions.reduce((sum, s) => sum + ((s as any).drinkCount ?? ((s as any).hasDrink ? 1 : 0)), 0);
  const extrasRevenue = extrasCount * settings.priceDrink;
  const sessionsCount = todaySessions.length;
  const minutesSold = todaySessions.reduce((sum, s) => sum + s.durationMin, 0);
  const capacityMinutes = postes.length * 12 * 60;
  const fillPct = capacityMinutes > 0 ? Math.round((minutesSold / capacityMinutes) * 100) : 0;
  const uniqueClients = new Set(todaySessions.filter(s => s.ticketId).map(s => s.ticketId)).size;

  // --- stats par poste ---
  const posteStats = postes.map(p => {
    const ps = todaySessions.filter(s => s.posteId === p.id);
    return {
      name: p.name,
      emoji: p.emoji ?? '🎮',
      count: ps.length,
      revenue: ps.reduce((sum, s) => sum + s.amount, 0),
      minutes: ps.reduce((sum, s) => sum + s.durationMin, 0),
    };
  }).filter(p => p.count > 0).sort((a, b) => b.revenue - a.revenue);

  // --- durées populaires ---
  const durationMap: Record<number, number> = {};
  todaySessions.forEach(s => { durationMap[s.durationMin] = (durationMap[s.durationMin] ?? 0) + 1; });
  const durBreakdown = Object.entries(durationMap)
    .map(([min, count]) => ({ min: Number(min), count }))
    .sort((a, b) => b.count - a.count);

  function exportCSV() {
    if (todaySessions.length === 0) { showToast('Aucune session à exporter', '⚠️'); return; }
    let csv = 'Heure;Poste;Client;Durée;Boisson;Montant_FCFA\n';
    todaySessions.forEach(s => {
      const time = new Date(s.ts).toLocaleTimeString('fr-FR');
      const dc = (s as any).drinkCount ?? ((s as any).hasDrink ? 1 : 0);
      csv += `${time};${s.posteName};${s.clientName ?? 'Anonyme'};${fmtDuration(s.durationMin)};${dc > 0 ? dc : 'Non'};${s.amount}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kingston-caisse-${today}.csv`;
    a.click();
    showToast('Export CSV téléchargé', '📥');
  }

  function printRapport() {
    if (todaySessions.length === 0) { showToast('Aucune session à imprimer', '⚠️'); return; }

    const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const posteRows = posteStats.map(p => `
      <tr>
        <td>${p.emoji} ${p.name}</td>
        <td>${p.count}</td>
        <td>${p.minutes} min</td>
        <td style="text-align:right;font-weight:700">${fmtMoney(p.revenue)}</td>
      </tr>`).join('');

    const durRows = durBreakdown.map(d => `
      <tr>
        <td>${fmtDuration(d.min)}</td>
        <td>${d.count} session${d.count > 1 ? 's' : ''}</td>
        <td>${fmtMoney((durationMap[d.min] ?? 0) * (settings.prices[d.min] ?? d.min * settings.customPricePerMinute))}</td>
      </tr>`).join('');

    const sessionRows = todaySessions.slice().reverse().map(s => `
      <tr>
        <td>${new Date(s.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${s.posteName}</td>
        <td>${s.clientName ?? '—'}</td>
        <td>${fmtDuration(s.durationMin)}</td>
        <td>${((s as any).drinkCount ?? ((s as any).hasDrink ? 1 : 0)) > 0 ? `🥤×${(s as any).drinkCount ?? 1}` : '—'}</td>
        <td style="text-align:right;font-weight:700">${fmtMoney(s.amount)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport Kingston Gaming — ${today}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; color: #111; background: #fff; padding: 32px; font-size: 12px; }
    h1 { font-family: 'Oswald', sans-serif; font-size: 26px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    h2 { font-family: 'Oswald', sans-serif; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; color: #333; border-bottom: 2px solid #E8A33D; padding-bottom: 4px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 3px solid #E8A33D; padding-bottom: 16px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo { width: 52px; height: 52px; background: #E8A33D; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-family: 'Oswald', sans-serif; font-size: 20px; font-weight: 700; color: #111; }
    .brand-text h1 { font-size: 22px; }
    .brand-text p { color: #666; font-size: 11px; margin-top: 2px; }
    .header-right { text-align: right; font-size: 11px; color: #555; }
    .header-right strong { display: block; font-size: 13px; color: #111; font-weight: 600; text-transform: capitalize; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .kpi { background: #f7f7f7; border-radius: 10px; padding: 14px 16px; border-left: 4px solid #E8A33D; }
    .kpi.green { border-left-color: #3DDC84; }
    .kpi.blue { border-left-color: #5B9DFF; }
    .kpi-label { font-size: 10px; color: #777; font-weight: 500; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
    .kpi-value { font-family: 'Oswald', sans-serif; font-size: 22px; font-weight: 700; color: #111; line-height: 1; }
    .kpi-sub { font-size: 10px; color: #999; margin-top: 3px; }
    .section { margin-bottom: 22px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th { background: #f0f0f0; padding: 7px 10px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: #555; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #fafafa; }
    .totals-row td { font-weight: 700; background: #fff5e6 !important; border-top: 2px solid #E8A33D; font-size: 12px; }
    .footer { margin-top: 32px; border-top: 1px solid #ddd; padding-top: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
    .footer-sig { font-size: 11px; color: #777; }
    .sig-line { border-bottom: 1px solid #aaa; width: 200px; height: 40px; margin-bottom: 4px; }
    .badge { display: inline-block; background: #E8A33D; color: #111; border-radius: 4px; padding: 2px 7px; font-size: 10px; font-weight: 700; font-family: 'Oswald', sans-serif; }
    @media print {
      body { padding: 16px; }
      @page { margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="logo">KG</div>
      <div class="brand-text">
        <h1>Kingston Gaming</h1>
        <p>Salle de jeux — Pointe-Noire, Congo</p>
      </div>
    </div>
    <div class="header-right">
      <strong>${dateLabel}</strong>
      Imprimé à ${now}<br>
      <span class="badge">Rapport de fin de journée</span>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Recette du jour</div>
      <div class="kpi-value">${fmtMoney(revenue)}</div>
      <div class="kpi-sub">${sessionsCount} session${sessionsCount !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi green">
      <div class="kpi-label">Clients identifiés</div>
      <div class="kpi-value">${uniqueClients}</div>
      <div class="kpi-sub">avec ticket</div>
    </div>
    <div class="kpi blue">
      <div class="kpi-label">Taux de remplissage</div>
      <div class="kpi-value">${fillPct}%</div>
      <div class="kpi-sub">sur 12h × ${postes.length} postes</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Boissons / extras</div>
      <div class="kpi-value">${fmtMoney(extrasRevenue)}</div>
      <div class="kpi-sub">${extrasCount} vendue${extrasCount !== 1 ? 's' : ''}</div>
    </div>
  </div>

  ${posteStats.length > 0 ? `
  <div class="section">
    <h2>Performance par poste</h2>
    <table>
      <thead><tr><th>Poste</th><th>Sessions</th><th>Temps vendu</th><th style="text-align:right">Recette</th></tr></thead>
      <tbody>
        ${posteRows}
        <tr class="totals-row">
          <td>TOTAL</td>
          <td>${sessionsCount}</td>
          <td>${minutesSold} min</td>
          <td style="text-align:right">${fmtMoney(revenue)}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  ${durBreakdown.length > 0 ? `
  <div class="section">
    <h2>Durées populaires</h2>
    <table>
      <thead><tr><th>Durée</th><th>Nombre</th><th>Recette estimée</th></tr></thead>
      <tbody>${durRows}</tbody>
    </table>
  </div>` : ''}

  <div class="section">
    <h2>Détail des sessions</h2>
    <table>
      <thead><tr><th>Heure</th><th>Poste</th><th>Client</th><th>Durée</th><th>Extra</th><th style="text-align:right">Montant</th></tr></thead>
      <tbody>
        ${sessionRows}
        <tr class="totals-row">
          <td colspan="5">TOTAL GÉNÉRAL</td>
          <td style="text-align:right">${fmtMoney(revenue + extrasRevenue)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <div class="footer-sig">
      <div class="sig-line"></div>
      <div>Signature du responsable</div>
    </div>
    <div style="text-align:right;font-size:10px;color:#aaa">
      Kingston Gaming — Caisse interne<br>
      Généré automatiquement • ${today}
    </div>
  </div>

  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { showToast('Autoriser les pop-ups pour imprimer', '⚠️'); return; }
    win.document.write(html);
    win.document.close();
  }

  function handleClear() {
    if (!confirm('Clôturer la journée ? Cela vide les sessions du jour (les tickets et réglages restent).')) return;
    clearTodaySessions();
    showToast('Journée clôturée', '🗂️');
  }

  return (
    <div className="caisse-view">
      <div className="section-head flex items-baseline justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="section-title">Caisse du jour</h2>
          <p className="section-hint">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="Recette du jour" value={fmtMoney(revenue)} sub={`${sessionsCount} session${sessionsCount !== 1 ? 's' : ''}`} color="#E8A33D" />
        <KpiCard label="Clients identifiés" value={String(uniqueClients)} sub="avec ticket" color="#3DDC84" />
        <KpiCard label="Taux remplissage" value={fillPct + '%'} sub={`sur 12h × ${postes.length} postes`} color="#5B9DFF" />
        <KpiCard label="Boissons / extras" value={fmtMoney(extrasRevenue)} sub={`${extrasCount} vendue${extrasCount !== 1 ? 's' : ''}`} color="#E8A33D" />
      </div>

      <div className="section-head flex items-baseline justify-between mb-3 mt-4 flex-wrap gap-3">
        <h2 className="section-title">Historique du jour</h2>
      </div>

      {todaySessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <p>Aucune session aujourd'hui pour l'instant</p>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Heure</th>
                <th>Poste</th>
                <th>Client</th>
                <th>Durée</th>
                <th>Extra</th>
                <th>Paiement</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {todaySessions.slice().reverse().map((s, i) => (
                <tr key={s.id} style={{ animationDelay: `${Math.min(i, 10) * 0.04}s` }} className="animate-row">
                  <td>{new Date(s.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{s.posteName}</td>
                  <td>{s.clientName ?? <span style={{ color: '#5C6373' }}>—</span>}</td>
                  <td>{fmtDuration(s.durationMin)}</td>
                  <td>{(() => { const dc = (s as any).drinkCount ?? ((s as any).hasDrink ? 1 : 0); return dc > 0 ? `🥤×${dc}` : '—'; })()}</td>
                  <td>{s.paymentMethod === 'airtel_money' ? <span className="pm-badge airtel">Airtel</span> : s.paymentMethod === 'mtn_money' ? <span className="pm-badge mtn">MTN</span> : <span className="pm-badge cash">Esp.</span>}</td>
                  <td className="amount">{fmtMoney(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="day-actions">
        <button className="day-btn primary" onClick={printRapport}>🖨️ Rapport PDF</button>
        <button className="day-btn" onClick={exportCSV}>📥 Exporter CSV</button>
        <button className="day-btn danger" onClick={handleClear}>🗑️ Clôturer la journée</button>
      </div>
    </div>
  );
}
