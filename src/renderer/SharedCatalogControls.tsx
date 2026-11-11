import React, { useState } from 'react';
import type { Settings } from '../domain/settings';
import type { CatalogConnectionStatus } from '../main/shared-catalog-connection';
import { Tooltip } from './Tooltip';
export function SharedCatalogControls({ value, onChange }: {value: Settings; onChange(value:Settings):void}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CatalogConnectionStatus | null>(null);
  const check = async () => {
    setChecking(true); setResult(null);
    try { setResult(await window.tpv.getSharedCatalogStatus(value.sharedCatalogConfigFile || undefined)); }
    catch { setResult({status:'unavailable'}); }
    finally { setChecking(false); }
  };
  const messages: Record<string,string> = {
    'configuration-error':'Choose the private client configuration supplied for this host, or provision its default configuration.',
    unauthorized:'Shared catalog access was rejected. Check or replace the client configuration.',
    forbidden:'This client does not have access to the shared catalog.',
    unavailable:'The shared catalog could not be reached. Saved searches may still be available offline.',
    'timed-out':'The shared catalog did not respond in time. Saved searches may still be available offline.',
    'rate-limited':'The shared catalog is busy. Wait before checking again.',
    'invalid-response':'The shared catalog returned an unsupported response.',
  };
  return <details className="settings-group">
    <summary>Shared Karaoke Nerds Catalog</summary>
    <div className="settings-group__content">
      <label className="settings-check"><input type="checkbox" checked={value.sharedCatalogEnabled} onChange={event => onChange({...value,sharedCatalogEnabled:event.target.checked})} /> Use the shared catalog when configured</label>
      <p className="muted">Searches use our shared catalog service. The Karaoke Nerds key and database credentials stay on the server. Previously saved searches can work offline; new searches need a connection.</p>
      <Tooltip text={value.sharedCatalogConfigFile || 'Uses the private catalog-connection.json in this app’s data folder'}><button type="button" disabled={checking} onClick={() => {
        void window.tpv.chooseSharedCatalogConfiguration().then(file => { if (file) {onChange({...value,sharedCatalogConfigFile:file});setResult(null);} }).catch(() => setResult({status:'configuration-error'}));
      }}>{value.sharedCatalogConfigFile ? `Configuration: ${value.sharedCatalogConfigFile.split(/[\\/]/).pop()}` : 'Choose catalog configuration…'}</button></Tooltip>
      <button type="button" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check catalog connection'}</button>
      {result?.status === 'ready' ? <p role="status">{result.source === 'cache' ? 'Offline saved status' : 'Connected'} · {result.recordCount?.toLocaleString()} catalog records · {result.searchableCount?.toLocaleString()} searchable videos. {result.lastSuccess === null ? 'Upstream refresh time is unknown.' : result.lastSuccess ? `Last feed refresh: ${new Date(result.lastSuccess).toLocaleString()}.` : ''}{result.source === 'cache' && result.fetchedAt !== undefined ? ` Status saved: ${new Date(result.fetchedAt).toLocaleString()}.` : ''}{result.stale ? ' Catalog freshness could not be confirmed.' : ''}</p> : result && <p role="status">{messages[result.status] || 'The catalog is not available.'}</p>}
      {result?.status === 'ready' && result.cachePersisted === false && <p role="status">This status could not be saved for offline use. Check available disk space and app data permissions.</p>}
      <p className="muted">Save preferences to change where searches run. Choosing or checking a client configuration does not refresh the upstream feed.</p>
    </div>
  </details>;
}
