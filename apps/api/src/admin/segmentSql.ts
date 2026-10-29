/**
 * A segment's conditions as one SQL condition on `users u`, with its parameters. Every value is
 * a parameter; only fixed SQL is written here, so nothing a staff member types reaches the query.
 */
import type { SegmentDefinition, SegmentRule } from '@whosabi/shared-types';

const DAY = 86_400_000;

export interface CompiledSegment {
  where: string;
  params: unknown[];
}

export function compileSegment(definition: SegmentDefinition, now: number): CompiledSegment {
  const params: unknown[] = [];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const ago = (days: number) => p(new Date(now - days * DAY));
  const one = (rule: SegmentRule): string => {
    switch (rule.field) {
      case 'platform':
        return `coalesce(u.last_platform, u.signup_platform) = ANY(${p(rule.in)}::text[])`;
      case 'home_state':
        return `u.home_state = ANY(${p(rule.in)}::text[])`;
      case 'age_band':
        return `u.age_band::text = ANY(${p(rule.in)}::text[])`;
      case 'account':
        return rule.is === 'guest' ? `u.status = 'guest'` : `u.status <> 'guest'`;
      case 'joined_within_days':
        return `u.created_at >= ${ago(rule.days)}`;
      case 'active_within_days':
        return `u.last_seen_at >= ${ago(rule.days)}`;
      case 'inactive_for_days':
        return `(u.last_seen_at IS NULL OR u.last_seen_at < ${ago(rule.days)})`;
      case 'duels_finished':
        return `(SELECT count(*) FROM duels d
                  WHERE (d.player_a = u.id OR d.player_b = u.id) AND d.state IN ('complete', 'forfeit')
                    AND d.completed_at >= ${ago(rule.within_days)}) >= ${p(rule.min)}`;
      case 'purchased':
        return `${rule.ever ? '' : 'NOT '}EXISTS (SELECT 1 FROM purchases pu
                  WHERE pu.user_id = u.id AND pu.status = 'completed' AND pu.environment = 'production')`;
      case 'coins_at_least':
        return `coalesce((SELECT a.balance FROM ledger_accounts a
                  WHERE a.owner_user_id = u.id AND a.currency = 'coins'), 0) >= ${p(rule.n)}`;
      case 'level_at_least':
        return `u.level >= ${p(rule.n)}`;
      case 'streak_at_least':
        return `coalesce((SELECT s.current FROM streaks s WHERE s.user_id = u.id), 0) >= ${p(rule.n)}`;
    }
  };
  const where = [`u.status NOT IN ('bot', 'deleted')`, ...definition.rules.map(one)].join(' AND ');
  return { where, params };
}
