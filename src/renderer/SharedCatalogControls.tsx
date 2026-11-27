import React, { useState } from 'react';
import type { Settings } from '../domain/settings';
import type { CatalogConnectionStatus } from '../main/shared-catalog-connection';
import { Tooltip } from './Tooltip';
export function SharedCatalogControls({ value, onChange }: {value: Settings; onChange(value:Settings):void}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CatalogConnectionStatus | null>(null);
  const check = async () => {
    setChecking(true); setResult(null);
    try { setResult(await window.tpv.getSharedCatalogStatus(value.sharedCatalogConfigFile)); }
    catch { setResult({status:'unavailable'}); }
    finally { setChecking(false); }
  };
  const messages: Record<string,string> = {
    'configuration-error':'The selected private configuration is invalid or unreadable. Choose a valid owner-only file, or clear the selection to use the public catalog.',
    unauthorized:'Shared catalog access was rejected. Check or replace the client configuration.',
    forbidden:'This client does not have access to the shared catalog.',
    unavailable:'The shared catalog could not be reached. Saved searches may still be available offline.',
    'timed-out':'The shared catalog did not respond in time. Saved searches may still be available offline.',
    'rate-limited':'The shared catalog is busy. Wait before checking again.',
    'invalid-response':'The shared catalog returned an unsupported response.',
  };
  return <>
      <label className="settings-check"><input type="checkbox" checked={value.sharedCatalogEnabled} onChange={event => onChange({...value,sharedCatalogEnabled:event.target.checked})} /> Use the shared catalog when configured</label>
      <p className="muted">Private profiles are optional. Previously saved searches can work offline.</p>
      <Tooltip text={value.sharedCatalogConfigFile || 'Uses the public catalog, or this host’s default private profile when installed'}><button type="button" disabled={checking} onClick={() => {
        void window.tpv.chooseSharedCatalogConfiguration().then(file => { if (file) {onChange({...value,sharedCatalogConfigFile:file});setResult(null);} }).catch(() => setResult({status:'configuration-error'}));
      }}>{value.sharedCatalogConfigFile ? `Configuration: ${value.sharedCatalogConfigFile.split(/[\\/]/).pop()}` : 'Choose catalog configuration…'}</button></Tooltip>
      {value.sharedCatalogConfigFile && <button type="button" disabled={checking} onClick={() => { onChange({ ...value, sharedCatalogConfigFile: '' }); setResult(null); }}>Use Default Catalog</button>}
      <button type="button" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check catalog connection'}</button>
      {result?.status === 'ready' ? <p role="status">{result.source === 'cache' ? 'Offline saved status' : 'Connected'} · {result.recordCount?.toLocaleString()} catalog records · {result.searchableCount?.toLocaleString()} searchable videos. {result.lastSuccess === null ? 'Upstream refresh time is unknown.' : result.lastSuccess ? `Last feed refresh: ${new Date(result.lastSuccess).toLocaleString()}.` : ''}{result.source === 'cache' && result.fetchedAt !== undefined ? ` Status saved: ${new Date(result.fetchedAt).toLocaleString()}.` : ''}{result.stale ? ' Catalog freshness could not be confirmed.' : ''}</p> : result && <p role="status">{messages[result.status] || 'The catalog is not available.'}</p>}
      {result?.status === 'ready' && result.cachePersisted === false && <p role="status">This status could not be saved for offline use. Check available disk space and app data permissions.</p>}
  </>;
}
