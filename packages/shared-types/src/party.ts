/**
 * Party rooms (GDD §2.2, TRD §4.4, API §2.7 and §3): the REST side that makes rooms and seats,
 * and the messages on the room's WebSocket. Everyone sees the same question at the same moment;
 * the server keeps the clock, and each player gets the options in their own order.
 */
import { z } from 'zod';

export const PartySettings = z
  .object({
    questions: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
    timer_s: z.union([z.literal(10), z.literal(15), z.literal(20)]),
    /** The packs to ask from (category ids). */
    categories: z.array(z.string().min(1).max(40)).min(1).max(12),
    family_safe: z.boolean(),
    /** The last 3 questions harder and worth double. */
    wahala: z.boolean(),
    /** False is host screen mode: the host's screen shows the questions, and the host doesn't play. */
    host_plays: z.boolean(),
  })
  .strict();
export type PartySettings = z.infer<typeof PartySettings>;

/** A name for the room: 2–20 characters, letters, numbers, spaces and a little punctuation. */
export const PartyNickname = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u, 'use letters, numbers and spaces');

export const CreatePartyRequest = z
  .object({
    settings: PartySettings,
    /** For a player with no username yet (a guest). */
    nickname: PartyNickname.optional(),
  })
  .strict();
export type CreatePartyRequest = z.infer<typeof CreatePartyRequest>;

export const JoinPartyRequest = z
  .object({
    /** Needed without an account, or a guest in the app with no username. */
    nickname: PartyNickname.optional(),
    /** A big screen (a TV) the host opens: it shows the game and doesn't play. Host only. */
    screen: z.literal(true).optional(),
  })
  .strict();
export type JoinPartyRequest = z.infer<typeof JoinPartyRequest>;

// ----- The room's WebSocket (API §3). Every message is JSON with a `type`. -----

/** Client → server. */
export const PartyClientMessage = z.discriminatedUnion('type', [
  /** Clock sync: the reply carries the server time. */
  z.object({ type: z.literal('time'), t0: z.number() }),
  z.object({ type: z.literal('settings'), settings: PartySettings }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('kick'), player_id: z.string().min(1).max(80) }),
  z.object({ type: z.literal('lock'), locked: z.boolean() }),
  z.object({
    type: z.literal('answer'),
    qid: z.string().min(1).max(80),
    display_index: z.number().int().min(0).max(15),
    client_elapsed_ms: z.number().int().min(0).max(120_000).nullable(),
  }),
  z.object({ type: z.literal('play_again') }),
  z.object({ type: z.literal('leave') }),
]);
export type PartyClientMessage = z.infer<typeof PartyClientMessage>;

export * from './partyProtocol';
