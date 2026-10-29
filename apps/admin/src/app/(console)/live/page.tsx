/** Live (doc 18 §6, step 2.7a): the first look is drawn on the server, then the view keeps itself fresh. */
import { routes, type AdminProfile } from '@whosabi/shared-types';
import { adminApi } from '../../../lib/api';
import { loadLive } from './actions';
import { LiveView } from './LiveView';

export default async function LivePage() {
  const [me, initial] = await Promise.all([adminApi<AdminProfile>(routes.admin.me()), loadLive('')]);
  return <LiveView initial={initial} canManage={me.permissions.includes('live.manage')} />;
}
