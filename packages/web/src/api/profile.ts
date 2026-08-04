// Singleton user profile read/write

import { apiGet, apiSend } from './client.js';
import type { UserProfile, ProfilePatch } from './types.js';

export function getProfile(): Promise<UserProfile> {
  return apiGet<UserProfile>('/profile');
}

/**
 * `profilePatchSchema` is `.strict()` — an unknown key is a 400, so build the
 * body from a whitelist, never by spreading a form object. An empty body is
 * also a 400 (`requireNonEmpty`): don't send a no-op save.
 */
export function patchProfile(body: ProfilePatch): Promise<UserProfile> {
  return apiSend<UserProfile>('PATCH', '/profile', body);
}
