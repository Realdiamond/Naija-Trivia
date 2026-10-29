/**
 * The nightly ledger check (doc 08 "Ledger"): every transaction must sum to zero in each
 * currency, and each player's cached balance must equal their entries added up. Anything off is
 * a problem alert for owners and admins, once a night. Nothing is corrected here: a wrong
 * balance needs a person to look at why.
 */
import { watDate } from '@whosabi/game-rules';
import { raiseStaffAlert } from '../admin/alerts';
import type { JobDeps } from './deps';

/** West Africa Time is UTC+1 all year. */
const WAT_OFFSET_MS = 3_600_000;
/** After the night's calibration, while the game is quiet (WAT). */
export const LEDGER_CHECK_HOUR = 4;

export interface LedgerCheckResult {
  /** Transactions whose entries don't sum to zero in a currency. */
  unbalanced: number;
  /** Players' accounts whose cached balance differs from their entries. */
  drifted: number;
}

export async function checkLedger(deps: JobDeps): Promise<LedgerCheckResult | null> {
  const now = deps.clock.now();
  if (new Date(now + WAT_OFFSET_MS).getUTCHours() < LEDGER_CHECK_HOUR) return null;
  const key = `job:ledger-check:${watDate(now)}`;
  if ((await deps.redis.set(key, '1', 'EX', 2 * 24 * 3600, 'NX')) !== 'OK') return null;
  try {
    const unbalanced = Number(
      (
        await deps.pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM (
             SELECT e.transaction_id FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
              GROUP BY e.transaction_id, a.currency HAVING sum(e.amount) <> 0) x`,
        )
      ).rows[0]!.n,
    );
    const drifted = Number(
      (
        await deps.pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM ledger_accounts a
             LEFT JOIN (SELECT account_id, sum(amount) AS total FROM ledger_entries GROUP BY account_id) s
                    ON s.account_id = a.id
            WHERE a.owner_user_id IS NOT NULL AND a.balance <> COALESCE(s.total, 0)`,
        )
      ).rows[0]!.n,
    );
    if (unbalanced > 0 || drifted > 0) {
      deps.log.error({ unbalanced, drifted }, 'the coin ledger does not add up');
      await raiseStaffAlert(deps.pool, {
        kind: 'problem',
        title: "Coin balances don't add up",
        body: `${drifted} ${drifted === 1 ? 'player balance differs' : 'player balances differ'} from the ledger and ${unbalanced} ${unbalanced === 1 ? 'transaction does' : 'transactions do'} not balance. Ask a developer to look before anyone is given coins.`,
        dedupeKey: `ledger:${watDate(now)}`,
        now,
      });
    }
    return { unbalanced, drifted };
  } catch (err) {
    await deps.redis.del(key); // try again next run
    throw err;
  }
}
