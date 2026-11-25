import { validPhotoDataUrl } from './photo';

export const MAX_PROFILE_AVATAR_BYTES = 48 * 1024;
const MAX_AVATAR_DATA_URL = 4 * Math.ceil(MAX_PROFILE_AVATAR_BYTES / 3) + 'data:image/jpeg;base64,'.length;
export const MAX_PROFILE_DETAILS_BODY = MAX_AVATAR_DATA_URL + 2048;

export type SingerProfileDetails = { pronouns: string; bio: string; avatar: string | null };
export const EMPTY_SINGER_PROFILE: SingerProfileDetails = { pronouns: '', bio: '', avatar: null };

export function parseSingerProfileDetails(value: unknown): SingerProfileDetails | null {
  if (!value || typeof value !== 'object') return null;
  const { pronouns, bio, avatar } = value as Partial<SingerProfileDetails>;
  if (typeof pronouns !== 'string' || [...pronouns.trim()].length > 32 || /[\x00-\x1f\x7f]/u.test(pronouns) ||
      typeof bio !== 'string' || [...bio.trim()].length > 160 || /[\x00-\x1f\x7f]/u.test(bio)) return null;
  if (avatar !== null && (!validPhotoDataUrl(avatar) || avatar.length > MAX_AVATAR_DATA_URL ||
      !avatar.startsWith('data:image/jpeg;base64,/9j/'))) return null;
  return { pronouns: pronouns.trim(), bio: bio.trim(), avatar };
}
