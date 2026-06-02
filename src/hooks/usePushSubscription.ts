'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buf = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) buf[i] = rawData.charCodeAt(i);
  return buf.buffer;
}

export function usePushSubscription(profileId: string | undefined): void {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!profileId || subscribedRef.current || !VAPID_PUBLIC_KEY) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    async function subscribe() {
      try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();

        if (!sub) {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return;
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

        const supabase = createClient();
        await supabase.from('push_subscriptions').upsert(
          {
            profile_id: profileId as string,
            endpoint: json.endpoint as string,
            p256dh: json.keys.p256dh as string,
            auth_key: json.keys.auth as string,
          },
          { onConflict: 'profile_id,endpoint' }
        );

        subscribedRef.current = true;
      } catch (err) {
        console.error('Push subscription error', err);
      }
    }

    subscribe();
  }, [profileId]);
}
