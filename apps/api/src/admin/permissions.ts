/**
 * Staff roles and what they may do (doc 18 §3). Roles combine and anything not granted is
 * denied. The console's v0 needs only a few permissions; each admin module adds its own.
 */
import { PRIVILEGED_ROLES, type AdminPermission, type AdminRole } from '@whosabi/shared-types';

const PLAYER_SUPPORT: AdminPermission[] = [
  'players.search',
  'players.view',
  'players.search_phone',
  'pii.reveal',
];

// Doc 04 §3: writers draft, a second person fact-checks, editors publish.
const CONTENT_ALL: AdminPermission[] = [
  'content.view',
  'content.write',
  'content.review',
  'content.publish',
  'content.import',
];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: [...PLAYER_SUPPORT, 'audit.view', 'staff.manage', ...CONTENT_ALL],
  admin: [...PLAYER_SUPPORT, 'audit.view', ...CONTENT_ALL],
  dpo: [...PLAYER_SUPPORT, 'audit.view'],
  support: PLAYER_SUPPORT,
  // Moderators see players masked only.
  moderator: ['players.search', 'players.view'],
  analyst: ['content.view'],
  growth: [],
  liveops: ['content.view'],
  editor: CONTENT_ALL,
  fact_checker: ['content.view', 'content.write', 'content.review'],
  // Writers see and edit their own questions only.
  writer: ['content.view', 'content.write'],
  finance: [],
  sponsor_manager: [],
  engineer: [],
  viewer: [],
};

export function permissionsFor(roles: readonly AdminRole[]): AdminPermission[] {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))].sort();
}

/** Grants made by the bootstrap command (`pnpm admin:add`), before any owner can approve. */
export const SYSTEM_ADMIN_ID = 'adm_system';

export interface GrantRow {
  role: AdminRole;
  granted_by: string;
  approved_by: string | null;
  expires_at: Date | null;
}

/** A grant counts once it has not expired and, for privileged roles, a second person approved it. */
export function isActiveGrant(grant: GrantRow, now: number): boolean {
  if (grant.expires_at && grant.expires_at.getTime() <= now) return false;
  if (!PRIVILEGED_ROLES.includes(grant.role)) return true;
  return grant.approved_by !== null || grant.granted_by === SYSTEM_ADMIN_ID;
}
