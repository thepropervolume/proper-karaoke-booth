/** Host-only companion metadata. These are not playable local song versions. */
export type KHostBridgeSong = {
  resultId: string;
  providerSongId: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  canHandoff: boolean;
};
export type KHostBridgeFailureStatus = 'unavailable' | 'unauthorized' | 'invalid-request' | 'busy'
  | 'expired-result' | 'handoff-unavailable' | 'provider-unavailable' | 'protocol-error'
  | 'idempotency-conflict' | 'unknown-request' | 'configuration-error' | 'sign-in-required' | 'not-configured' | 'policy-blocked';
export type KHostBridgeFailure = { status: KHostBridgeFailureStatus; requestId?: string; mayHaveBeenAccepted?: boolean };
export type KHostBridgeStatus = KHostBridgeFailure | {
  status: 'ready'; companion: 'KHost'; provider: 'karafun'; providerAvailable: boolean;
  externalPlayback: true; embeddedPlayback: false; acquisition: false;
};
export type KHostBridgeSearch = KHostBridgeFailure | {
  status: 'ready'; songs: KHostBridgeSong[]; externalPlayback: true; embeddedPlayback: false;
};
export type KHostBridgeHandoff = KHostBridgeFailure | {
  status: 'handed-off'; requestId: string; state: 'pending' | 'complete' | 'failed';
  playback: 'external-khost'; queueMayHaveChanged: true;
};
export type KHostPendingHandoff = { requestId: string; title: string; artist: string; uncertain: boolean; sending: boolean; result: KHostBridgeHandoff };
export type KHostBridgeUiStatus = { configured: boolean; connection: KHostBridgeStatus; pending: KHostPendingHandoff | null };
export type KHostBridgeApi = {
  status(): Promise<KHostBridgeUiStatus>;
  chooseProfile(): Promise<KHostBridgeUiStatus>;
  clearProfile(): Promise<KHostBridgeUiStatus>;
  search(query: string): Promise<KHostBridgeSearch>;
  cancelSearch(): Promise<void>;
  handoff(value: { resultId: string; requestId: string }): Promise<KHostBridgeHandoff>;
  handoffStatus(requestId: string): Promise<KHostBridgeHandoff>;
  acknowledgeHandoff(requestId: string): Promise<KHostBridgeUiStatus>;
};
