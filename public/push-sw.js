self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function notificationCenterUrl(notificationId = 0) {
  const query = Number(notificationId) > 0 ? `?notif_id=${Number(notificationId)}` : '';
  return new URL(`./#/notifications${query}`, self.registration.scope).href;
}

function safeNotificationTarget(data = {}) {
  const fallback = notificationCenterUrl(data.notif_id);
  const savedLink = String(data.link || '').trim();
  let candidate = String(data.url || '').trim();

  // Prefer the notification's saved application destination. The server also
  // supplies `url`, while this keeps the worker compatible with older senders.
  if (savedLink.startsWith('/') && !savedLink.startsWith('//') && !savedLink.includes('\\')) {
    candidate = `./#${savedLink}`;
  }
  if (!candidate) return fallback;

  try {
    const target = new URL(candidate, self.registration.scope);
    const scope = new URL(self.registration.scope);
    return target.origin === scope.origin && target.href.startsWith(scope.href)
      ? target.href
      : fallback;
  } catch (error) {
    return fallback;
  }
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch (error) {
      data = { title: 'New notification', body: event.data ? event.data.text() : '' };
    }

    const title = String(data.title || 'New notification');
    const targetUrl = safeNotificationTarget(data);
    await self.registration.showNotification(title, {
      body: String(data.body || ''),
      icon: new URL('./push-icon.png?v=1', self.registration.scope).href,
      badge: new URL('./push-badge.png?v=1', self.registration.scope).href,
      tag: String(data.tag || `notification-${data.notif_id || Date.now()}`),
      renotify: true,
      data: {
        url: targetUrl,
        link: String(data.link || ''),
        notif_id: Number(data.notif_id || 0),
      },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = safeNotificationTarget(event.notification?.data || {});
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scope = new URL(self.registration.scope);
    const root = scope.pathname.endsWith('/public/')
      ? scope.pathname.slice(0, -'public/'.length)
      : scope.pathname;
    const appPaths = new Set([scope.pathname, `${scope.pathname}index.html`, root, `${root}index.php`]);
    const appWindows = windows.filter(client => {
      try {
        const url = new URL(client.url);
        return url.origin === scope.origin && appPaths.has(url.pathname);
      } catch (error) { return false; }
    }).sort((a, b) => Number(b.focused) - Number(a.focused));
    for (const client of appWindows) {
      try {
        const current = new URL(client.url);
        const destination = new URL(targetUrl);
        // WindowClient.navigate may not notify a hash router consistently.
        // The message updates the route without reloading the running app.
        const focused = await client.focus();
        if (current.hash !== destination.hash && 'navigate' in client) {
          await client.navigate(targetUrl);
        }
        (focused || client).postMessage({ type: 'OPEN_NOTIFICATION_PAGE', url: targetUrl });
        return;
      } catch (error) {
        // A stale/closed tab must not prevent the destination opening elsewhere.
        continue;
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
