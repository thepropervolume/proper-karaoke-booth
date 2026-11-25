import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { GuestSnapshot } from '../remote/client';
import type { DiscoveredRoom } from './discovery';
import { parseSingerNoticePreferences, SingerNoticeTracker, type SingerNoticePreferences } from './singer-notifications';
import './singer-notifications.css';

type DisplayPermission = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';
type DevicePermission = DisplayPermission | 'checking' | 'unavailable';
interface LocalNotificationsPlugin {
  checkPermissions(): Promise<{ display: DisplayPermission }>;
  requestPermissions(): Promise<{ display: DisplayPermission }>;
  areEnabled(): Promise<{ value: boolean }>;
  schedule(options: { notifications: { id: number; title: string; body: string }[] }): Promise<unknown>;
}
const localNotifications = registerPlugin<LocalNotificationsPlugin>('LocalNotifications');
const PREFERENCES_KEY = 'tpv-singer-notifications-v1';
const usable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');

function readPreferences() {
  try { return parseSingerNoticePreferences(localStorage.getItem(PREFERENCES_KEY)); }
  catch { return parseSingerNoticePreferences(null); }
}
async function permission(): Promise<DevicePermission> {
  if (!usable()) return 'unavailable';
  try {
    const { display } = await localNotifications.checkPermissions();
    return display === 'granted' && Capacitor.getPlatform() === 'android' && !(await localNotifications.areEnabled()).value ? 'denied' : display;
  } catch { return 'unavailable'; }
}

type SingerNotificationInput = {
  snapshot?: GuestSnapshot | null;
  nearby: readonly DiscoveredRoom[];
  joined: boolean;
  enabled: boolean;
};

export function useSingerNotifications({ snapshot, nearby, joined, enabled }: SingerNotificationInput) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [permissionState, setPermission] = useState<DevicePermission>(usable() ? 'checking' : 'unavailable');
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [prompting, setPrompting] = useState(false);
  const alive = useRef(true);
  const permissionRequest = useRef(0);
  const [tracker] = useState(() => new SingerNoticeTracker());
  const counter = useRef(Date.now() % 1_000_000_000);
  const destination = joined ? JSON.stringify([snapshot?.showId, snapshot?.hostEpoch, snapshot?.singerId]) : 'nearby';
  const scheduleState = useRef({ enabled, preferences, visible, destination });
  scheduleState.current = { enabled, preferences, visible, destination };

  const refreshPermission = useCallback(async () => {
    const request = ++permissionRequest.current;
    const state = await permission();
    if (alive.current && request === permissionRequest.current) setPermission(state);
    return state;
  }, []);

  useEffect(() => {
    alive.current = true;
    const onVisibility = () => {
      const onScreen = document.visibilityState === 'visible';
      setVisible(onScreen);
      if (onScreen) void refreshPermission();
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      alive.current = false;
      ++permissionRequest.current;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [refreshPermission]);

  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); }
    catch { /* Preferences still work until the app closes. */ }
  }, [preferences]);

  useEffect(() => {
    const alerts = tracker.observe({ snapshot, nearby, joined, active: enabled && visible },
      { ...preferences, enabled: preferences.enabled && permissionState === 'granted' });
    if (!alerts.length) return;
    void permission().then(state => {
      const current = scheduleState.current;
      if (!alive.current || state !== 'granted' || !current.enabled || !current.preferences.enabled ||
          !current.visible || current.destination !== destination || current.preferences !== preferences || document.visibilityState !== 'visible') return;
      const notifications = alerts.map(alert => {
        counter.current = (counter.current + 1) % 1_000_000_000;
        return { ...alert, id: counter.current + 1 };
      });
      return localNotifications.schedule({ notifications });
    }).catch(() => {});
  }, [snapshot, nearby, joined, enabled, visible, preferences, permissionState, destination, tracker]);

  async function enableDeviceAlerts(): Promise<void> {
    if (!usable() || prompting) return;
    setPrompting(true);
    try {
      const state = await permission();
      if (state === 'prompt' || state === 'prompt-with-rationale') await localNotifications.requestPermissions();
      if (await refreshPermission() === 'granted' && alive.current) setPreferences(current => ({ ...current, enabled: true }));
    } catch {
      if (alive.current) setPermission('unavailable');
    } finally {
      if (alive.current) setPrompting(false);
    }
  }

  function setOption<K extends keyof SingerNoticePreferences>(key: K, value: SingerNoticePreferences[K]): void {
    setPreferences(current => ({ ...current, [key]: value }));
  }

  return { preferences, permission: permissionState, prompting, enable: enableDeviceAlerts, setOption };
}

type Controller = ReturnType<typeof useSingerNotifications>;
export function SingerNotificationSettings({ controller }: { controller: Controller }) {
  const { preferences, permission, prompting, enable, setOption } = controller;
  if (permission === 'unavailable') return <p className="mobile-quiet">{Capacitor.isNativePlatform()
    ? 'Device alerts are unavailable in this build.'
    : 'Device alerts require the installed Booth app for iPhone or Android.'}</p>;
  return <div className="singer-notification-settings">
    <p className="mobile-quiet">Get alerts for your turn, available requests, and nearby rooms while Booth is open. Alerts are silent in kiosk mode.</p>
    {permission === 'checking' && <p role="status">Checking notification settings…</p>}
    {permission === 'denied' && <p role="status">Allow notifications for Booth in your device’s Settings to receive these alerts.</p>}
    {preferences.enabled ?
      <button type="button" onClick={() => setOption('enabled', false)}>Turn Off Device Alerts</button> :
      permission !== 'checking' && permission !== 'denied' && <button type="button" className="mobile-primary" disabled={prompting}
        onClick={() => void enable()}>{prompting ? 'Checking…' : 'Enable Device Alerts'}</button>}
    <fieldset>
      <label htmlFor="singer-turn-alert">Remind me before my turn</label>
      <select id="singer-turn-alert" value={preferences.turn}
        onChange={event => setOption('turn', Number(event.currentTarget.value) as SingerNoticePreferences['turn'])}>
        <option value={0}>Off</option><option value={1}>1 song away</option><option value={2}>2 songs away</option><option value={3}>3 songs away</option>
      </select>
      <label><input type="checkbox" checked={preferences.ready} onChange={event => setOption('ready', event.currentTarget.checked)} /> A song request becomes available</label>
      <label><input type="checkbox" checked={preferences.nearby} onChange={event => setOption('nearby', event.currentTarget.checked)} /> A karaoke room appears on my Wi-Fi</label>
    </fieldset>
  </div>;
}