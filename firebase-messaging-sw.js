// =================================================================================
// Service Worker สำหรับรับการแจ้งเตือนแบบพุช (Firebase Cloud Messaging - Web Push)
// ระบบศูนย์การเรียนรู้ Sprinkle Knowledge (PWA Service Worker)
// Milestone 3: Official SPRINKLE Branding, Robust Payload Parsing & Deep-Link Bridge
// =================================================================================

// 1. Official SPRINKLE Branding Constants
const SPRINKLE_LOGO_URL = 'https://lh3.googleusercontent.com/d/1DTKNi7relqZQ41ULEdLPHGWx9026wKPs';
const DEFAULT_TITLE = 'ศูนย์การเรียนรู้ Sprinkle';
const DEFAULT_BODY = 'มีข้อมูลข่าวสารใหม่ในระบบศูนย์การเรียนรู้';
const DEFAULT_URL = '/';
const VIBRATE_PATTERN = [200, 100, 200];

// 2. Firebase App & Messaging SDK Imports (Web Worker / Service Worker Environment)
if (typeof importScripts === 'function') {
    try {
        importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
        importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
    } catch (importErr) {
        console.warn('[firebase-messaging-sw.js] importScripts error:', importErr);
    }
}

// 3. ค่าการตั้งค่าเริ่มต้นของ Firebase (Firebase Project Config)
const firebaseConfig = {
    apiKey: "AIzaSyCHxAVoOSdNoBS9HaISnWodE5vYxscMJK4",
    authDomain: "studio-8742716914-acc69.firebaseapp.com",
    databaseURL: "https://studio-8742716914-acc69-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "studio-8742716914-acc69",
    storageBucket: "studio-8742716914-acc69.firebasestorage.app",
    messagingSenderId: "537794597030",
    appId: "1:537794597030:web:583288d5edd4fa8c6a2467"
};

/**
 * 4. Helper: แยกวิเคราะห์ Query Parameters จาก URL อย่างปลอดภัย
 * ใช้สำหรับดึง annId หรือ manualId กรณี payload ระบุมาใน targetUrl
 */
function parseUrlParams(url) {
    const params = {};
    if (!url || typeof url !== 'string') return params;
    try {
        const queryIndex = url.indexOf('?');
        if (queryIndex !== -1) {
            const queryString = url.slice(queryIndex + 1).split('#')[0];
            const pairs = queryString.split('&');
            for (let i = 0; i < pairs.length; i++) {
                const pair = pairs[i];
                if (!pair) continue;
                const eqIndex = pair.indexOf('=');
                if (eqIndex !== -1) {
                    const key = decodeURIComponent(pair.slice(0, eqIndex).trim());
                    const val = decodeURIComponent(pair.slice(eqIndex + 1).trim());
                    if (key) params[key] = val;
                } else {
                    const key = decodeURIComponent(pair.trim());
                    if (key) params[key] = '';
                }
            }
        }
    } catch (e) {
        // กรณี decodeURIComponent พบคู่รหัสไม่สมบูรณ์
    }
    return params;
}

/**
 * 5. Robust Payload Parser: สกัดข้อมูลจากทั้ง payload.notification และ payload.data
 * รองรับทั้งรูปแบบ FCM v1, WebPush notification, Data-only messages และ Fallback text
 */
function extractNotificationData(raw) {
    if (!raw || typeof raw !== 'object') {
        const fallbackText = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_BODY;
        return {
            title: DEFAULT_TITLE,
            body: fallbackText,
            icon: SPRINKLE_LOGO_URL,
            badge: SPRINKLE_LOGO_URL,
            url: DEFAULT_URL,
            annId: null,
            manualId: null,
            tag: 'sprinkle-notification-' + Date.now(),
            data: {
                url: DEFAULT_URL,
                annId: null,
                manualId: null,
                title: DEFAULT_TITLE,
                body: fallbackText
            }
        };
    }

    const n = raw.notification || (raw.webpush && raw.webpush.notification) || {};
    const d = raw.data || {};
    const fcmOpts = (raw.webpush && raw.webpush.fcm_options) || {};

    const title = n.title || d.title || raw.title || DEFAULT_TITLE;
    const body = n.body || d.body || raw.body || DEFAULT_BODY;

    // Official SPRINKLE branding fallback for icon and badge
    const icon = n.icon || d.icon || SPRINKLE_LOGO_URL;
    const badge = n.badge || d.badge || SPRINKLE_LOGO_URL;

    // Destination target URL resolution
    let targetUrl = d.url || d.targetUrl || d.link || n.click_action || fcmOpts.link || raw.url || DEFAULT_URL;

    // Extract deep-link identifiers (annId, manualId)
    let annId = d.annId || raw.annId || null;
    let manualId = d.manualId || raw.manualId || null;

    if (typeof targetUrl === 'string') {
        const params = parseUrlParams(targetUrl);
        if (!annId && params.annId) annId = params.annId;
        if (!manualId && params.manualId) manualId = params.manualId;
    }

    const tag = d.tag || n.tag || raw.tag || ('sprinkle-notification-' + Date.now());

    // Consolidated data payload passed into showNotification options.data
    const notifData = Object.assign({}, d, {
        url: targetUrl,
        annId: annId,
        manualId: manualId,
        title: title,
        body: body
    });

    return {
        title: title,
        body: body,
        icon: icon,
        badge: badge,
        url: targetUrl,
        annId: annId,
        manualId: manualId,
        tag: tag,
        data: notifData
    };
}

/**
 * 6. Notification Click Navigation Bridge
 * จัดการเมื่อผู้ใช้คลิกที่การแจ้งเตือน:
 * - ปิดการแจ้งเตือน
 * - ค้นหาหน้าต่างเบราว์เซอร์ที่เปิดอยู่แล้วบน origin เดียวกัน
 * - ส่ง postMessage: { type: 'NOTIFICATION_CLICK', url: targetUrl, annId: ..., manualId: ... }
 * - Focus ไปยังแท็บที่เปิดอยู่
 * - หากยังไม่มีแท็บเปิดอยู่ ให้เปิดหน้าต่างใหม่ด้วย openWindow(targetUrl)
 */
function handleNotificationClick(event, clientsScope) {
    if (event && event.notification && typeof event.notification.close === 'function') {
        event.notification.close();
    }

    const notifData = (event && event.notification && event.notification.data) || {};
    const targetUrl = notifData.url || DEFAULT_URL;
    const annId = notifData.annId || null;
    const manualId = notifData.manualId || null;

    const clientsTarget = clientsScope || (typeof clients !== 'undefined' ? clients : null);
    if (!clientsTarget || typeof clientsTarget.matchAll !== 'function') {
        return Promise.resolve();
    }

    const swOrigin = (typeof self !== 'undefined' && self.location && self.location.origin) ? self.location.origin : '';

    return clientsTarget.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        let matchingClient = null;

        if (clientList && clientList.length > 0) {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (!client) continue;

                let isSameOrigin = false;
                if (swOrigin && client.url) {
                    try {
                        const cUrl = new URL(client.url, swOrigin);
                        isSameOrigin = (cUrl.origin === swOrigin);
                    } catch (e) {
                        isSameOrigin = false;
                    }
                } else {
                    isSameOrigin = true;
                }

                if (isSameOrigin && typeof client.focus === 'function') {
                    matchingClient = client;
                    if (client.focused) {
                        break;
                    }
                }
            }
        }

        if (matchingClient) {
            // ส่งข้อความ postMessage ไปยังหน้าต่างที่เปิดอยู่
            if (typeof matchingClient.postMessage === 'function') {
                matchingClient.postMessage({
                    type: 'NOTIFICATION_CLICK',
                    action: 'NOTIFICATION_NAVIGATE',
                    url: targetUrl,
                    annId: annId,
                    manualId: manualId,
                    data: notifData
                });
            }

            // นำทางหน้าเว็บหากอยู่ที่ URL อื่นและจำเป็น
            if (targetUrl && targetUrl !== DEFAULT_URL && typeof matchingClient.navigate === 'function' && !matchingClient.postMessage) {
                try {
                    matchingClient.navigate(targetUrl);
                } catch (navErr) {
                    console.warn('[firebase-messaging-sw.js] navigate error:', navErr);
                }
            }

            return matchingClient.focus();
        }

        // หากยังไม่มีแท็บเปิดอยู่ ให้เปิดหน้าต่างใหม่ด้วย clients.openWindow
        if (typeof clientsTarget.openWindow === 'function') {
            let fullUrl = targetUrl;
            if (swOrigin && targetUrl) {
                try {
                    fullUrl = new URL(targetUrl, swOrigin).href;
                } catch (urlErr) {
                    fullUrl = targetUrl;
                }
            }
            return clientsTarget.openWindow(fullUrl);
        }

        return Promise.resolve();
    });
}

// 7. Firebase Messaging Background Message Handler
try {
    if (typeof firebase !== 'undefined' && typeof firebase.initializeApp === 'function') {
        firebase.initializeApp(firebaseConfig);
        const messaging = firebase.messaging();

        messaging.onBackgroundMessage(function(payload) {
            console.log('[firebase-messaging-sw.js] ได้รับข้อความ Background Message:', payload);

            const extracted = extractNotificationData(payload);

            const notificationOptions = {
                body: extracted.body,
                icon: extracted.icon,
                badge: extracted.badge,
                tag: extracted.tag,
                data: extracted.data,
                requireInteraction: true,
                vibrate: VIBRATE_PATTERN
            };

            if (typeof self !== 'undefined' && self.registration && typeof self.registration.showNotification === 'function') {
                return self.registration.showNotification(extracted.title, notificationOptions);
            }
        });
    }
} catch (sdkErr) {
    console.warn('[firebase-messaging-sw.js] Firebase SDK init info:', sdkErr);
}

// 8. Service Worker Native Event Listeners
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
    // ดักรับสัญญาณ Push ดิบจากเบราว์เซอร์ (Fallback Push Event Listener)
    self.addEventListener('push', function(event) {
        if (!event.data) {
            return;
        }

        let rawPayload = null;
        try {
            rawPayload = event.data.json();
        } catch (err) {
            rawPayload = {
                notification: {
                    title: DEFAULT_TITLE,
                    body: event.data.text()
                }
            };
        }

        const extracted = extractNotificationData(rawPayload);

        const notificationOptions = {
            body: extracted.body,
            icon: extracted.icon,
            badge: extracted.badge,
            tag: extracted.tag,
            data: extracted.data,
            requireInteraction: true,
            vibrate: VIBRATE_PATTERN
        };

        if (self.registration && typeof self.registration.showNotification === 'function') {
            event.waitUntil(self.registration.showNotification(extracted.title, notificationOptions));
        }
    });

    // ดักรับเหตุการณ์เมื่อ Service Worker ติดตั้งและเปิดใช้งาน ให้ Active ทันที
    self.addEventListener('install', function(event) {
        self.skipWaiting();
    });

    self.addEventListener('activate', function(event) {
        event.waitUntil(self.clients.claim());
    });

    // ดักรับ fetch event สำหรับรองรับมาตรฐาน PWA Installability
    self.addEventListener('fetch', function(event) {
        // Pass-through network requests
    });

    // ดักรับเหตุการณ์เมื่อผู้ใช้คลิกที่การแจ้งเตือน (Notification Click Event)
    self.addEventListener('notificationclick', function(event) {
        event.waitUntil(handleNotificationClick(event));
    });
}

// 9. Module Exports for Node.js Testing Environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SPRINKLE_LOGO_URL,
        DEFAULT_TITLE,
        DEFAULT_BODY,
        DEFAULT_URL,
        VIBRATE_PATTERN,
        firebaseConfig,
        parseUrlParams,
        extractNotificationData,
        handleNotificationClick
    };
}
