export function fmtMoney(n: number) {
  return Math.round(n).toLocaleString('fr-FR') + ' F';
}

export function fmtTime(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

export function fmtDuration(min: number) {
  if (min === 30) return '30 min';
  if (min === 60) return '1h';
  if (min === 90) return '1h30';
  if (min === 120) return '2h';
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? h + 'h' : h + 'h' + String(m).padStart(2, '0');
}

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function fmtDateTime(ts: number) {
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const TICKET_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TICKET_CODE_LENGTH = 7;
export const TICKET_VALID_MS = 7 * 24 * 60 * 60 * 1000;

export function generateTicketCode(takenCodes: string[]): string {
  let code = '', attempts = 0;
  const now = Date.now();
  do {
    code = Array.from({ length: TICKET_CODE_LENGTH }, () =>
      TICKET_CODE_CHARS[Math.floor(Math.random() * TICKET_CODE_CHARS.length)]
    ).join('');
    attempts++;
  } while (takenCodes.includes(code) && attempts < 100);
  return code;
}

export function isTicketValid(ticket: { dateExpiration: number; usedSavedTime: boolean }) {
  return ticket.dateExpiration > Date.now() && !ticket.usedSavedTime;
}

export function ticketStatus(ticket: { dateExpiration: number; usedSavedTime: boolean }): 'valid' | 'exhausted' | 'expired' {
  if (ticket.usedSavedTime) return 'exhausted';
  if (ticket.dateExpiration <= Date.now()) return 'expired';
  return 'valid';
}

export function msToMin(ms: number) {
  return Math.floor(ms / 60000);
}

export function fmtMs(ms: number) {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}min${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}min${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function getWeekStart(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function getMonthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
