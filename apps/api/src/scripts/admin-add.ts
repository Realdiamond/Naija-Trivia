/**
 * pnpm --filter @whosabi/api admin:add <email> "<name>" <role>[,<role>…]
 * (in production: node dist/scripts/admin-add.js …)
 *
 * Adds a staff member with roles. It is how the first owner gets in, before anyone exists to
 * approve a grant; after that, owners add staff in the console with four-eyes approval
 * (doc 18 §3). Grants made here are logged as the system's.
 */
import { AdminRole } from '@whosabi/shared-types';
import { writeAudit } from '../admin/audit';
import { SYSTEM_ADMIN_ID } from '../admin/permissions';
import { createPool, withTransaction } from '../db';
import { newId } from '../ids';

const [email, name, roleList] = process.argv.slice(2).filter((a) => a !== '--');
const roles = (roleList ?? '').split(',').filter(Boolean);
if (!email || !name || roles.length === 0) {
  console.error('Usage: admin:add <email> "<name>" <role>[,<role>…]');
  console.error(`Roles: ${AdminRole.options.join(', ')}`);
  process.exit(1);
}
const parsedRoles = roles.map((r) => AdminRole.parse(r));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const pool = createPool(url);
try {
  const id = await withTransaction(pool, async (client) => {
    // The system's own row, so its grants have a granter; it can never sign in.
    await client.query(
      `INSERT INTO admin_users (id, email, name, status)
       VALUES ($1, 'system@whosabi.invalid', 'Who Sabi? system', 'removed') ON CONFLICT (id) DO NOTHING`,
      [SYSTEM_ADMIN_ID],
    );
    const row = await client.query<{ id: string }>(
      `INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, status = 'active'
       RETURNING id`,
      [newId('adm'), email.toLowerCase(), name],
    );
    const adminId = row.rows[0]!.id;
    for (const role of parsedRoles) {
      await client.query(
        `INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)
         ON CONFLICT (admin_id, role) DO UPDATE SET granted_by = $3, approved_by = NULL, expires_at = NULL`,
        [adminId, role, SYSTEM_ADMIN_ID],
      );
      await writeAudit(client, {
        actor: 'system',
        action: 'grant_role',
        entity: 'admin',
        entityId: adminId,
        reason: 'admin:add command',
        after: { role },
      });
    }
    return adminId;
  });
  console.log(`${email}: ${parsedRoles.join(', ')} (${id})`);
} finally {
  await pool.end();
}
