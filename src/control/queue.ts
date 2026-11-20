import { orderedFuture, type Command, type Envelope, type ShowState, type SongRequest } from '../domain';
import type { Settings } from '../domain/settings';
import { ControlError } from './protocol';

export const CONTROL_QUEUE_COMMANDS = ['request', 'accept', 'rejectRequest', 'removeRequest', 'moveRequest', 'promoteRequest'] as const;
type QueueCommandType = typeof CONTROL_QUEUE_COMMANDS[number];
export type ControlQueueCommand = Extract<Command, { type: QueueCommandType }>;
export type ControlQueueEnvelope = Omit<Envelope, 'actor' | 'command'> & { command: ControlQueueCommand };
export type ControlQueueView = Pick<Envelope, 'showId' | 'hostEpoch'> & {
  revision: number;
  requests: Array<Pick<SongRequest, 'id' | 'singerId' | 'versionId'> & { status: 'pending' | 'queued'; title: string; artist: string; singer: string }>;
  truncated: boolean;
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const exact = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

function parseQueueCommand(command: unknown): ControlQueueCommand | null {
  if (!record(command) || !id(command.requestId)) return null;
  const { type, requestId } = command;
  switch (type) {
    case 'request':
      return exact(command, ['type', 'requestId', 'versionId', 'singerId']) && id(command.versionId) && (command.singerId === null || id(command.singerId))
        ? { type, requestId, versionId: command.versionId, singerId: command.singerId } : null;
    case 'moveRequest':
      return exact(command, ['type', 'requestId', 'beforeRequestId']) && (command.beforeRequestId === null || id(command.beforeRequestId))
        ? { type, requestId, beforeRequestId: command.beforeRequestId } : null;
    case 'accept': case 'rejectRequest': case 'removeRequest': case 'promoteRequest':
      return exact(command, ['type', 'requestId']) ? { type, requestId } : null;
    default: return null;
  }
}

/** Only validated queue operations can enter the host authority from this API. */
export function parseControlQueueEnvelope(value: unknown): ControlQueueEnvelope {
  if (record(value) && exact(value, ['commandId', 'showId', 'hostEpoch', 'expectedRevision', 'command']) &&
      uuid(value.commandId) && id(value.showId) && id(value.hostEpoch) && typeof value.expectedRevision === 'number' &&
      Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0) {
    const command = parseQueueCommand(value.command);
    if (command) return { commandId: value.commandId, showId: value.showId, hostEpoch: value.hostEpoch,
      expectedRevision: value.expectedRevision, command };
  }
  throw new ControlError('invalid-request', 'Provide a queue command with the current show ID, host epoch, expected revision and a v4 command UUID.');
}

export function projectControlQueue(state: ShowState, rotation: Settings['rotationMode'], now: number): ControlQueueView {
  const requests = [...orderedFuture(state, rotation, now), ...state.requests.filter(request => request.status === 'pending')];
  const versions = new Map(state.versions.map(version => [version.id, version]));
  const singers = new Map(state.singers.map(singer => [singer.id, singer.name]));
  const maximumRequests = 100;
  return { showId: state.showId, hostEpoch: state.hostEpoch, revision: state.revision, truncated: requests.length > maximumRequests,
    requests: requests.slice(0, maximumRequests).map(request => {
      const version = versions.get(request.versionId);
      const singer = [request.singerId, request.coSingerId].flatMap(id => id ? [singers.get(id) ?? ''] : []).filter(Boolean).join(' & ');
      return { id: request.id, versionId: request.versionId, singerId: request.singerId,
        status: request.status === 'pending' ? 'pending' : 'queued', title: version?.title ?? 'Unknown song', artist: version?.artist ?? '', singer };
    }) };
}
