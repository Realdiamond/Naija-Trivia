import { z } from 'zod';

export const Platform = z.enum(['android', 'ios', 'web']);
export type Platform = z.infer<typeof Platform>;

/** RFC 9457 problem+json, the body of every error response (doc 09 §1). */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  request_id: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;

/** Machine-readable error codes. Clients branch on these, never on titles. */
export const ErrorCode = {
  validation: 'VALIDATION_FAILED',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  rateLimited: 'RATE_LIMITED',
  refreshReused: 'REFRESH_TOKEN_REUSED',
  roundExpired: 'ROUND_EXPIRED',
  questionNotServed: 'QUESTION_NOT_SERVED',
  outOfOrder: 'QUESTION_OUT_OF_ORDER',
  noQuestions: 'NO_QUESTIONS_AVAILABLE',
  requestInProgress: 'REQUEST_IN_PROGRESS',
  turnNotYours: 'TURN_NOT_YOURS',
  duelFinished: 'DUEL_FINISHED',
  duelLimitReached: 'DUEL_LIMIT_REACHED',
  duelAlreadyStarted: 'DUEL_ALREADY_STARTED',
  opponentUnavailable: 'OPPONENT_UNAVAILABLE',
  inviteTaken: 'INVITE_TAKEN',
  categoryNotOffered: 'CATEGORY_NOT_OFFERED',
  categoryNotPicked: 'CATEGORY_NOT_PICKED',
  alreadyAnswered: 'ALREADY_ANSWERED',
  dailyClosed: 'DAILY_CLOSED',
  dailyAlreadyPlayed: 'DAILY_ALREADY_PLAYED',
  dailyNotFinished: 'DAILY_NOT_FINISHED',
  otpInvalid: 'OTP_INVALID',
  otpExpired: 'OTP_EXPIRED',
  otpTooManyAttempts: 'OTP_TOO_MANY_ATTEMPTS',
  otpLimitReached: 'OTP_LIMIT_REACHED',
  captchaRequired: 'CAPTCHA_REQUIRED',
  captchaFailed: 'CAPTCHA_FAILED',
  idTokenInvalid: 'ID_TOKEN_INVALID',
  providerUnavailable: 'PROVIDER_UNAVAILABLE',
  accountUnavailable: 'ACCOUNT_UNAVAILABLE',
  accountRequired: 'ACCOUNT_REQUIRED',
  usernameTaken: 'USERNAME_TAKEN',
  usernameNotAllowed: 'USERNAME_NOT_ALLOWED',
  usernameLocked: 'USERNAME_LOCKED',
  ageNotAllowed: 'AGE_NOT_ALLOWED',
  ageAlreadySet: 'AGE_ALREADY_SET',
  userUnavailable: 'USER_UNAVAILABLE',
  friendsOnly: 'FRIENDS_ONLY',
  internal: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
