import type { Policy } from '../domain';

const MAX_POLICY_IDS = 10_000;
function versionIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_POLICY_IDS) return undefined;
  const result: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim() || id.length > 500) return undefined;
    result.push(id);
  }
  return result;
}

/** Parse only the public policy fields; callers still enforce the host authority. */
export function parseHostPolicy(value: unknown): Policy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.ageRestricted !== 'boolean') return null;
  const include = input.includeVersionIds === null ? null : versionIds(input.includeVersionIds);
  const exclude = versionIds(input.excludeVersionIds);
  if (include === undefined || exclude === undefined) return null;
  return { ageRestricted: input.ageRestricted, includeVersionIds: include, excludeVersionIds: exclude };
}
