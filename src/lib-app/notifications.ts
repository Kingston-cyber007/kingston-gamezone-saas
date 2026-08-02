/**
 * Web Notifications API — fires alongside sound alerts (never replaces them).
 * Requires Notification.permission === 'granted'; silently no-ops otherwise.
 */

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

export function notificationPermissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function fireWebNotification(
  kind: 'warning' | 'expired',
  posteName: string,
  minutesLeft: number
) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const isExpired = kind === 'expired';
  const title = isExpired
    ? `⏰ ${posteName} — Session terminée`
    : `⚠️ ${posteName} — ${minutesLeft} min restante${minutesLeft > 1 ? 's' : ''}`;
  const body = isExpired
    ? 'La session est terminée. Veuillez encaisser le client.'
    : `Il reste ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''} sur ce poste.`;

  try {
    new Notification(title, {
      body,
      icon: '/pwa-192.png',
      tag: posteName, // replaces any previous notification for the same poste
      requireInteraction: isExpired, // keep expired notifications visible until dismissed
    });
  } catch { /* silent fail — browser may block even after permission */ }
}
