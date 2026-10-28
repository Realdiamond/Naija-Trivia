/** Words for the Content module: statuses, actions, history lines, categories and report reasons. */
import type { QuestionAction, QuestionStatus } from '@whosabi/shared-types';

export const STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  live: 'Live',
  suspended: 'Suspended',
  retired: 'Retired',
};

/** Badge style per status: live is green, waiting is orange, out of the game is grey. */
export const STATUS_TONE: Record<QuestionStatus, '' | 'warn' | 'off'> = {
  draft: 'off',
  in_review: 'warn',
  approved: 'warn',
  live: '',
  suspended: 'warn',
  retired: 'off',
};

export const ACTION_LABEL: Record<QuestionAction, string> = {
  submit: 'Send for review',
  approve: 'Approve',
  send_back: 'Send back',
  publish: 'Publish',
  suspend: 'Suspend',
  restore: 'Put back live',
  retire: 'Retire',
  reopen: 'Reopen as draft',
};

const HISTORY_LABEL: Record<string, string> = {
  created: 'Created',
  imported: 'Imported',
  imported_live: 'Imported and published',
  edited: 'Edited',
  submit: 'Sent for review',
  approve: 'Approved',
  send_back: 'Sent back',
  publish: 'Published',
  suspend: 'Suspended',
  restore: 'Put back live',
  retire: 'Retired',
  reopen: 'Reopened',
  auto_suspended: 'Suspended by player reports',
  expired: 'Expired',
  reports_fixed: 'Reports closed: fixed',
  reports_rejected: 'Reports closed: nothing wrong',
  reports_retired: 'Reports closed: retired',
  recalibrated: 'Level set by the numbers',
  flagged: 'Flagged by the numbers',
  suspended_by_numbers: 'Suspended: most players pick another answer',
};

export function historyLabel(action: string): string {
  return HISTORY_LABEL[action] ?? action.replaceAll('_', ' ');
}

export const CATEGORY_NAME: Record<string, string> = {
  slang: 'Slang & Pidgin',
  nollywood: 'Nollywood',
  music: 'Music',
  food: 'Food',
  sport: 'Sport',
  mixed: 'Mixed Naija',
};

export const REASON_LABEL: Record<string, string> = {
  wrong_answer: 'Wrong answer',
  outdated: 'Outdated',
  offensive: 'Offensive',
  typo: 'Typo',
  unfair: 'Too hard or unfair',
  other: 'Other',
  too_hard: 'Too hard (from the numbers)',
  too_easy: 'Too easy (from the numbers)',
};

export const DIFFICULTY_LABEL = ['', '1 · easy', '2', '3 · medium', '4', '5 · expert'] as const;

/** "64%", or a dash before anyone has played it. */
export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
