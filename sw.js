const CACHE_NAME = 'arrowbrooke-halloween-v1';
const APP_URL = '/Halloween-Map/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data?.json() || {};
  } catch {
    message = { body: event.data?.text() || 'A new home was added to the Halloween map.' };
  }

  const options = {
    body: message.body || 'A new home was added to the Halloween map.',
    icon: 'icon-512.png',
    badge: 'icon-512.png',
    tag: message.tag || 'new-halloween-home',
    data: { url: message.url || APP_URL },
    vibrate: [120, 80, 120]
  };

  event.waitUntil(self.registration.showNotification(message.title || 'New Halloween home 🎃', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || APP_URL, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const windowClient of windows) {
      if (windowClient.url.startsWith(self.location.origin) && 'focus' in windowClient) {
        await windowClient.navigate(destination);
        return windowClient.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
});
