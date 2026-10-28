/**
 * The question workflow (doc 04 §3, doc 18 §3): writers draft and submit, a second person
 * fact-checks (approves or sends back), editors publish, suspend and retire. Nobody approves
 * their own question, and writers only touch their own.
 */
import type { AdminPermission, QuestionAction, QuestionStatus } from '@whosabi/shared-types';

interface Transition {
  from: readonly QuestionStatus[];
  to: QuestionStatus;
  permission: AdminPermission;
}

export const TRANSITIONS: Record<QuestionAction, Transition> = {
  submit: { from: ['draft'], to: 'in_review', permission: 'content.write' },
  approve: { from: ['in_review'], to: 'approved', permission: 'content.review' },
  send_back: { from: ['in_review', 'approved'], to: 'draft', permission: 'content.review' },
  publish: { from: ['approved'], to: 'live', permission: 'content.publish' },
  suspend: { from: ['live'], to: 'suspended', permission: 'content.publish' },
  restore: { from: ['suspended'], to: 'live', permission: 'content.publish' },
  retire: {
    from: ['draft', 'in_review', 'approved', 'live', 'suspended'],
    to: 'retired',
    permission: 'content.publish',
  },
  reopen: { from: ['retired'], to: 'draft', permission: 'content.publish' },
};

/** Moves that need the Question Bible checks to pass, source link included. */
export const CHECKED_ACTIONS: readonly QuestionAction[] = ['submit', 'approve', 'publish', 'restore'];

export interface Actor {
  id: string;
  permissions: readonly AdminPermission[];
}

export interface QuestionState {
  status: QuestionStatus;
  author_id: string | null;
}

/** Writers without review rights work on their own questions only. */
export function canSee(actor: Actor, q: QuestionState): boolean {
  if (!actor.permissions.includes('content.view')) return false;
  return actor.permissions.includes('content.review') || q.author_id === actor.id;
}

export function canEdit(actor: Actor, q: QuestionState): boolean {
  if (!canSee(actor, q)) return false;
  switch (q.status) {
    case 'draft':
    case 'in_review':
      return actor.permissions.includes('content.write');
    case 'approved':
    case 'live':
    case 'suspended':
      return actor.permissions.includes('content.publish');
    case 'retired':
      return false;
  }
}

export type Refusal = 'not_allowed' | 'wrong_status' | 'own_question';

export function refusal(actor: Actor, q: QuestionState, action: QuestionAction): Refusal | null {
  const t = TRANSITIONS[action];
  if (!canSee(actor, q) || !actor.permissions.includes(t.permission)) return 'not_allowed';
  if (!t.from.includes(q.status)) return 'wrong_status';
  if (action === 'approve' && q.author_id === actor.id) return 'own_question';
  return null;
}

export function allowedActions(actor: Actor, q: QuestionState): QuestionAction[] {
  return (Object.keys(TRANSITIONS) as QuestionAction[]).filter((a) => refusal(actor, q, a) === null);
}
