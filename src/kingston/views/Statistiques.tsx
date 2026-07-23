import { useMemo } from 'react';
import { useStore, Session } from '../store/useStore';
import { fmtMoney, fmtDuration, dayKey, getWeekStart, getMonthStart } from '../lib/helpers';

function StatCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: string; color?: string }) {
  return (
    <div className="stat-card animate-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: color ?? '#E8A33D' }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function BarChart({ data, label }: { data: { key: string; value: number; label: string }[]; label: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="bar-chart-wrap">
      <div className="bar-chart-label">{label}</div>
      <div className="bar-chart">
        {data.map((d, i) => (
          <div key={d.key} className="bar-col" title={`${d.label}: ${fmtMoney(d.value)}`}>
            <div className="bar-fill" style={{
              height: `${Math.max(4, (d.value / max) * 100)}%`,
              animationDelay: `${i * 0.05}s`,
            }} />
            <div className="bar-key">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniBarChart({ data, label }: { data: { key: string; value: number; label: string }[]; label: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="bar-chart-wrap">
      <div className="bar-chart-label">{label}</div>
      <div className="bar-chart" style={{ height: 60 }}>
        {data.map((d, i) => (
          <div key={d.key} className="bar-col" title={`${d.label}: ${d.value}`}>
            <div className="bar-fill" style={{
              height: `${Math.max(4, (d.value / max) * 100)}%`,
              animationDelay: `${i * 0.05}s`,
              background: '#5B9DFF',
            }} />
            <div className="bar-key">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupBy<T>(arr: T[], fn: (x: T) => string): Record<string, T[]> {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    acc[k] = acc[k] ?? [];
    acc[k].push(x);
    return acc;
  }, {} as Record<string, T[]>);
}

function last7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  return days;
}

function last4Weeks(): { key: string; label: string; start: Date }[] {
  const weeks: { key: string; label: string; start: Date }[] = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const start = getWeekStart(d);
    weeks.push({
      key: dayKey(start),
      label: `S${Math.floor(i === 0 ? 0 : i)}`,
      start,
    });
  }
  return weeks;
}

function last6Months(): { key: string; label: string; year: number; month: number }[] {
  const months: { key: string; label: string; year: number; month: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('fr-FR', { month: 'short' });
    months.push({ key, label, year: d.getFullYear(), month: d.getMonth() });
  }
  return months;
}

export function StatistiquesView() {
  const { sessions, tickets, postes } = useStore();

  const stats = useMemo(() => {
    const byDay = groupBy(sessions, s => s.day);
    const days = last7Days();
    const weekDays = last4Weeks();
    const monthList = last6Months();

    // Today
    const todayStr = dayKey(new Date());
    const todaySessions = byDay[todayStr] ?? [];
    const todayRevenue = todaySessions.reduce((s, x) => s + x.amount, 0);
    const todayClients = new Set(todaySessions.filter(s => s.ticketId).map(s => s.ticketId)).size;

    // This week
    const weekStart = getWeekStart();
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const weekSessions = sessions.filter(s => {
      const d = new Date(s.ts);
      return d >= weekStart && d < weekEnd;
    });
    const weekRevenue = weekSessions.reduce((s, x) => s + x.amount, 0);
    const weekClients = new Set(weekSessions.filter(s => s.ticketId).map(s => s.ticketId)).size;

    // This month
    const monthStart = getMonthStart();
    const monthSessions = sessions.filter(s => new Date(s.ts) >= monthStart);
    const monthRevenue = monthSessions.reduce((s, x) => s + x.amount, 0);
    const monthClients = new Set(monthSessions.filter(s => s.ticketId).map(s => s.ticketId)).size;

    // Total all time
    const totalRevenue = sessions.reduce((s, x) => s + x.amount, 0);
    const totalSessions = sessions.length;

    // Daily revenue chart (last 7 days)
    const dailyChart = days.map(d => {
      const ds = byDay[d] ?? [];
      return {
        key: d,
        value: ds.reduce((s, x) => s + x.amount, 0),
        label: new Date(d).toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 3),
      };
    });

    // Daily sessions chart
    const dailySessionsChart = days.map(d => ({
      key: d,
      value: (byDay[d] ?? []).length,
      label: new Date(d).toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 3),
    }));

    // Monthly chart
    const monthlyChart = monthList.map(m => {
      const ms = sessions.filter(s => {
        const d = new Date(s.ts);
        return d.getFullYear() === m.year && d.getMonth() === m.month;
      });
      return { key: m.key, value: ms.reduce((s, x) => s + x.amount, 0), label: m.label };
    });

    // Top postes
    const posteGroups = groupBy(sessions, s => s.posteName);
    const topPostes = Object.entries(posteGroups)
      .map(([name, ss]) => ({ name, sessions: ss.length, revenue: ss.reduce((s, x) => s + x.amount, 0) }))
      .sort((a, b) => b.revenue - a.revenue);

    // Duration breakdown
    const durationGroups = groupBy(sessions, s => String(s.durationMin));
    const durationBreakdown = Object.entries(durationGroups)
      .map(([min, ss]) => ({ min: parseInt(min), count: ss.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Avg session per day (last 7)
    const activeDays = days.filter(d => (byDay[d] ?? []).length > 0).length;
    const avgSessionsPerDay = activeDays > 0 ? Math.round(weekSessions.length / 7 * 10) / 10 : 0;

    // % of sessions with at least 1 drink
    const drinkSessions = sessions.filter(s => ((s as any).drinkCount ?? ((s as any).hasDrink ? 1 : 0)) > 0).length;
    const drinkPct = sessions.length > 0 ? Math.round((drinkSessions / sessions.length) * 100) : 0;

    // Payment method breakdown
    const cashCount = sessions.filter(s => !s.paymentMethod || s.paymentMethod === 'cash').length;
    const airtelCount = sessions.filter(s => s.paymentMethod === 'airtel_money').length;
    const mtnCount = sessions.filter(s => s.paymentMethod === 'mtn_money').length;
    const mobileMoneyRevenue = sessions
      .filter(s => s.paymentMethod === 'airtel_money' || s.paymentMethod === 'mtn_money')
      .reduce((sum, s) => sum + s.amount, 0);
    const mobileMoneyPct = sessions.length > 0 ? Math.round(((airtelCount + mtnCount) / sessions.length) * 100) : 0;

    return {
      todayRevenue, todayClients, todaySessions: todaySessions.length,
      weekRevenue, weekClients, weekSessions: weekSessions.length,
      monthRevenue, monthClients, monthSessions: monthSessions.length,
      totalRevenue, totalSessions,
      dailyChart, dailySessionsChart, monthlyChart,
      topPostes, durationBreakdown,
      avgSessionsPerDay, drinkPct,
      totalTickets: tickets.length,
      validTickets: tickets.filter(t => t.dateExpiration > Date.now()).length,
      cashCount, airtelCount, mtnCount, mobileMoneyRevenue, mobileMoneyPct,
    };
  }, [sessions, tickets]);

  return (
    <div className="stats-view">
      <div className="section-head mb-5">
        <h2 className="section-title">Tableau de bord statistiques</h2>
        <p className="section-hint">Cumul de toutes les sessions enregistrées</p>
      </div>

      {/* Period KPIs */}
      <div className="stats-period-grid">
        <div className="period-block">
          <div className="period-label">📅 Aujourd'hui</div>
          <div className="period-stats">
            <div className="period-kpi"><span className="pk-v" style={{ color: '#E8A33D' }}>{fmtMoney(stats.todayRevenue)}</span><span className="pk-l">recette</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#3DDC84' }}>{stats.todaySessions}</span><span className="pk-l">sessions</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#5B9DFF' }}>{stats.todayClients}</span><span className="pk-l">clients</span></div>
          </div>
        </div>
        <div className="period-block">
          <div className="period-label">📆 Cette semaine</div>
          <div className="period-stats">
            <div className="period-kpi"><span className="pk-v" style={{ color: '#E8A33D' }}>{fmtMoney(stats.weekRevenue)}</span><span className="pk-l">recette</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#3DDC84' }}>{stats.weekSessions}</span><span className="pk-l">sessions</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#5B9DFF' }}>{stats.weekClients}</span><span className="pk-l">clients</span></div>
          </div>
        </div>
        <div className="period-block">
          <div className="period-label">🗓 Ce mois</div>
          <div className="period-stats">
            <div className="period-kpi"><span className="pk-v" style={{ color: '#E8A33D' }}>{fmtMoney(stats.monthRevenue)}</span><span className="pk-l">recette</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#3DDC84' }}>{stats.monthSessions}</span><span className="pk-l">sessions</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#5B9DFF' }}>{stats.monthClients}</span><span className="pk-l">clients</span></div>
          </div>
        </div>
        <div className="period-block all-time">
          <div className="period-label">🏆 Tout temps</div>
          <div className="period-stats">
            <div className="period-kpi"><span className="pk-v" style={{ color: '#E8A33D' }}>{fmtMoney(stats.totalRevenue)}</span><span className="pk-l">total</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#3DDC84' }}>{stats.totalSessions}</span><span className="pk-l">sessions</span></div>
            <div className="period-kpi"><span className="pk-v" style={{ color: '#5B9DFF' }}>{stats.totalTickets}</span><span className="pk-l">tickets</span></div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-cards-grid">
        <StatCard icon="📊" label="Moy. sessions/jour" value={String(stats.avgSessionsPerDay)} sub="(7 derniers jours)" color="#5B9DFF" />
        <StatCard icon="🥤" label="Sessions avec boisson" value={`${stats.drinkPct}%`} sub="des sessions" color="#E8A33D" />
        <StatCard icon="🎫" label="Tickets valides" value={String(stats.validTickets)} sub={`/ ${stats.totalTickets} total`} color="#3DDC84" />
        <StatCard icon="📱" label="Mobile Money" value={`${stats.mobileMoneyPct}%`} sub={`Airtel ×${stats.airtelCount} · MTN ×${stats.mtnCount}`} color="#A78BFA" />
        <StatCard icon="⏱" label="Postes actifs" value={String(postes.filter(p => p.status === 'busy').length)} sub={`/ ${postes.length} postes`} color="#FF5C5C" />
      </div>

      {/* Charts */}
      <div className="charts-grid">
        <div className="chart-card animate-card">
          <BarChart data={stats.dailyChart} label="Recettes — 7 derniers jours" />
        </div>
        <div className="chart-card animate-card">
          <MiniBarChart data={stats.dailySessionsChart} label="Sessions — 7 derniers jours" />
        </div>
        <div className="chart-card animate-card">
          <BarChart data={stats.monthlyChart} label="Recettes mensuelles (6 mois)" />
        </div>
      </div>

      {/* Top postes + Duration breakdown */}
      <div className="bottom-stats-grid">
        <div className="settings-card animate-card">
          <h3 className="card-title">🕹️ Performance par poste</h3>
          {stats.topPostes.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}><p>Aucune session enregistrée</p></div>
          ) : (
            <table className="mini-table">
              <thead><tr><th>Poste</th><th>Sessions</th><th>Recette</th></tr></thead>
              <tbody>
                {stats.topPostes.map(p => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.sessions}</td>
                    <td style={{ color: '#3DDC84' }}>{fmtMoney(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="settings-card animate-card">
          <h3 className="card-title">⏱️ Durées populaires</h3>
          {stats.durationBreakdown.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 0' }}><p>Aucune donnée</p></div>
          ) : (
            <div className="duration-stats">
              {stats.durationBreakdown.map((d, i) => {
                const pct = stats.totalSessions > 0 ? Math.round((d.count / stats.totalSessions) * 100) : 0;
                return (
                  <div key={d.min} className="duration-stat-row">
                    <span className="ds-label">{fmtDuration(d.min)}</span>
                    <div className="ds-bar-wrap">
                      <div className="ds-bar" style={{ width: `${pct}%`, animationDelay: `${i * 0.1}s` }} />
                    </div>
                    <span className="ds-count">{d.count}× ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
