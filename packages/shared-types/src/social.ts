/**
 * Friends, blocks and contact discovery (doc 09 §2.3, TRD FR-SOC-1 and FR-SOC-2).
 * Friends need an account; guests play through links.
 */
import { z } from 'zod';
import { ProfileCard, Username } from './profile';

export const FriendSource = z.enum(['contacts', 'username', 'opponent', 'link', 'qr']);
export type FriendSource = z.infer<typeof FriendSource>;

export const FriendRequest = z.union([
  z.object({ user_id: z.string().min(3).max(40), source: FriendSource.optional() }).strict(),
  z.object({ username: Username, source: FriendSource.optional() }).strict(),
]);
export type FriendRequest = z.infer<typeof FriendRequest>;

export const FriendRequestResult = z.object({
  /** `pending` until they accept; `accepted` straight away if they had already asked you. */
  status: z.enum(['pending', 'accepted']),
  user: ProfileCard,
});
export type FriendRequestResult = z.infer<typeof FriendRequestResult>;

export const FriendEntry = z.object({ user: ProfileCard, since: z.iso.datetime() });

export const FriendsResponse = z.object({
  friends: z.array(FriendEntry),
  /** Requests waiting for you. */
  incoming: z.array(FriendEntry),
  /** Requests you sent. */
  outgoing: z.array(FriendEntry),
  /** Recent opponents who aren't friends yet (FR-SOC-1). */
  suggested: z.array(ProfileCard),
});
export type FriendsResponse = z.infer<typeof FriendsResponse>;

export const BlockRequest = z.object({ user_id: z.string().min(3).max(40) });
export type BlockRequest = z.infer<typeof BlockRequest>;

/**
 * k-anonymity contact discovery (FR-SOC-2): the app hashes each contact's E.164 number with
 * SHA-256 and sends only the first 20 bits (5 hex characters). The server returns every
 * discoverable player whose hash starts that way; the app matches the full hashes itself.
 */
export const DiscoveryRequest = z.object({
  prefixes: z
    .array(z.string().regex(/^[0-9a-f]{5}$/))
    .min(1)
    .max(500),
});
export type DiscoveryRequest = z.infer<typeof DiscoveryRequest>;

export const DiscoveryResponse = z.object({
  matches: z.array(
    z.object({
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      user_id: z.string(),
      username: z.string().nullable(),
      avatar_id: z.string().nullable(),
    }),
  ),
});
export type DiscoveryResponse = z.infer<typeof DiscoveryResponse>;
