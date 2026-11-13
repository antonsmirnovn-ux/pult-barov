// Рабочий чат: оболочка приложения + push-уведомления (Firebase Cloud Messaging).
const CACHE = "chat-v11";
const SHELL = ["./", "index.html", "config.js", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

importScripts("config.js");
const CFG = self.CHAT_CFG || {};
if (CFG.firebase && CFG.firebase.apiKey) {
  try {
    importScripts(FB + "firebase-app-compat.js", FB + "firebase-messaging-compat.js");
    firebase.initializeApp(CFG.firebase);
    const messaging = firebase.messaging();
    // Сообщения с блоком notification Firebase показывает сам. Здесь — только значок на иконке.
    messaging.onBackgroundMessage(() => { try { self.navigator.setAppBadge && self.navigator.setAppBadge(); } catch (_) {} });
  } catch (e) { console.warn("fcm sw", e); }
}

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "chat-photos").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
self.addEventListener("notificationclick", e => {
  const link = (e.notification.data && (e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.fcmOptions && e.notification.data.FCM_MSG.fcmOptions.link)) || "./";
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ("focus" in w) { w.postMessage({ type: "open", link }); return w.focus(); } }
    return self.clients.openWindow(link);
  }));
});
