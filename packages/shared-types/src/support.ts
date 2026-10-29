/**
 * Support (doc 16 §3, doc 18 §13, build plan step 2.7p): a player writes from the app's Help
 * screen; the message carries their app version, platform and account, is kept for User 360
 * and the console's queue, and goes to the helpdesk's inbox. Staff answer by email from the
 * helpdesk, or in the console, where the answer shows in the player's Help screen; the macros
 * give ready words for the common questions.
 */
import { z } from 'zod';

export const SupportTopic = z.enum(['purchase', 'streak', 'question', 'account', 'sign_in', 'ban', 'other']);
export type SupportTopic = z.infer<typeof SupportTopic>;

export const SupportTicketRequest = z.object({
  topic: SupportTopic,
  message: z.string().trim().min(10).max(2000),
  /** Where to answer, when not in the app (a guest has no other way to be reached). */
  email: z.email().max(254).nullable().optional(),
  /** The phone model or browser, as the app knows it. */
  device: z.string().trim().max(80).optional(),
});
export type SupportTicketRequest = z.infer<typeof SupportTicketRequest>;

export const SupportTicketStatus = z.enum(['open', 'answered']);
export type SupportTicketStatus = z.infer<typeof SupportTicketStatus>;

export const MySupportTicket = z.object({
  id: z.string(),
  topic: SupportTopic,
  message: z.string(),
  status: SupportTicketStatus,
  /** Support's answer in the app, for a player who gave no email (or as well as one). */
  answer: z.string().nullable(),
  created_at: z.iso.datetime(),
  answered_at: z.iso.datetime().nullable(),
});
export type MySupportTicket = z.infer<typeof MySupportTicket>;

export const MySupportTickets = z.object({ tickets: z.array(MySupportTicket) });
export type MySupportTickets = z.infer<typeof MySupportTickets>;

/** In the console (`players.support`): the contact address masked, as everywhere else. */
export const AdminSupportTicket = MySupportTicket.extend({
  user_id: z.string(),
  /** The username, or null for a guest. */
  player: z.string().nullable(),
  email: z.string().nullable(),
  platform: z.string(),
  app_version: z.string().nullable(),
  device: z.string().nullable(),
  emailed: z.boolean(),
  answered_by: z.string().nullable(),
});
export type AdminSupportTicket = z.infer<typeof AdminSupportTicket>;

export const AdminSupportQueue = z.object({
  tickets: z.array(AdminSupportTicket),
  /** Open ones, all of them, not just this page. */
  open: z.number().int(),
  /** Whether tickets are emailed to a helpdesk (SUPPORT_INBOX is set). */
  inbox: z.boolean(),
});
export type AdminSupportQueue = z.infer<typeof AdminSupportQueue>;

/** Answered (with an answer the player sees in the app, or none when answered by email), or open again. */
export const AdminSupportTicketUpdate = z.object({
  status: SupportTicketStatus,
  answer: z.string().trim().min(1).max(2000).optional(),
});
export type AdminSupportTicketUpdate = z.infer<typeof AdminSupportTicketUpdate>;

/** Ready answers for the common questions (doc 16 §3), in English and Pidgin, for support to adapt. */
export interface SupportMacro {
  topic: SupportTopic;
  title: string;
  en: string;
  pcm: string;
}

export const SUPPORT_MACROS: readonly SupportMacro[] = [
  {
    topic: 'purchase',
    title: 'Coins not received',
    en: "Sorry your coins didn't arrive. We've checked your payment with the store and added the coins to your account. Open the app again to see them. Thanks for your patience!",
    pcm: 'Sorry say your coins no land. We don check your payment with the store and we don add the coins for your account. Open the app again make you see am. Thank you for your patience!',
  },
  {
    topic: 'streak',
    title: 'Lost streak',
    en: "We've looked into your Daily streak and restored it. Keep the streak going, and remember you get one free freeze each week.",
    pcm: 'We don check your Daily streak and we don restore am. Make you no break am again, and remember say you get one free freeze every week.',
  },
  {
    topic: 'question',
    title: 'Wrong question',
    en: 'Thanks for flagging this question. Our editors have checked it and corrected the answer. If it changed the result of a game you played, your points have been updated too.',
    pcm: 'Thank you as you report this question. Our editors don check am and correct the answer. If e change the result of any game wey you play, we don update your points too.',
  },
  {
    topic: 'account',
    title: 'Username change',
    en: "We've freed up your username so you can choose a new one. Open the app and you'll be asked to pick it.",
    pcm: 'We don free your username make you fit choose new one. Open the app and e go ask you to pick am.',
  },
  {
    topic: 'account',
    title: 'Delete my account',
    en: "You can delete your account at once in the app: Settings, then \"Delete my account\". On the web, go to whosabi.ng/delete-account. If you can't sign in, reply from your account's email or phone and we'll do it within 30 days.",
    pcm: 'You fit delete your account sharp sharp for the app: Settings, then "Delete my account". For web, go whosabi.ng/delete-account. If you no fit sign in, reply from your account email or phone and we go do am within 30 days.',
  },
  {
    topic: 'ban',
    title: 'Ban appeal',
    en: "Thanks for writing. We've reviewed your account. [Explain the outcome: lifted, shortened or kept, and why.] Please keep to the community rules so it doesn't happen again.",
    pcm: 'Thank you as you write us. We don check your account. [Explain wetin happen: we remove am, reduce am or e still dey, and why.] Abeg follow the community rules make e no happen again.',
  },
  {
    topic: 'sign_in',
    title: 'Code not received',
    en: 'Sorry the sign-in code didn\'t arrive. Sometimes a network delays texts: wait a minute and tap "Send again", or sign in with your email or Google instead. If it still doesn\'t come, tell us your network (MTN, Airtel, Glo or 9mobile).',
    pcm: 'Sorry say the sign-in code no land. Sometimes network dey delay text: wait one minute and tap "Send again", or sign in with your email or Google. If e still no come, tell us your network (MTN, Airtel, Glo or 9mobile).',
  },
];
