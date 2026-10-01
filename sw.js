// Receives big-move alerts sent by push-alerts.js (via the price workflow) and shows them as
// notifications, whether or not the dashboard is open. It caches nothing: the page stays a plain
// static site, and this file only exists because a push needs somewhere to land.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
    let msg = { title: 'Portfolio alert', body: '' };
    try { msg = { ...msg, ...e.data.json() }; } catch { /* plain or empty payload */ }
    e.waitUntil(self.registration.showNotification(msg.title, {
        body: msg.body,
        tag: msg.tag || 'moves',      // a newer alert replaces an unread older one
        renotify: true,
    }));
});

// Tap: focus the dashboard if it is open, otherwise open it.
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const home = new URL('./', self.registration.scope).href;
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const open = list.find(c => c.url.startsWith(home));
        return open ? open.focus() : self.clients.openWindow(home);
    }));
});
