/** Bring questions in from the question bank (FR-CON-6). */
import type { AdminProfile } from '@whosabi/shared-types';
import { adminApi } from '../../../lib/api';
import { ImportForm } from './ImportForm';

export default async function Import() {
  const me = await adminApi<AdminProfile>('/admin/me');
  if (!me.permissions.includes('content.import')) {
    return <p className="error">Your roles don&apos;t include importing questions.</p>;
  }
  return (
    <>
      <h1>Import questions</h1>
      <div className="card stack small">
        <p>
          Use a category file from the question bank (
          <span className="mono">docs/content/question-bank/</span>, for example{' '}
          <span className="mono">sport.csv</span>) or a file in the seed format. Every row needs a source
          link.
        </p>
        <ul className="problems">
          <li>
            Rows marked <b>approved</b> in the question bank arrive approved, ready to publish.
          </li>
          <li>
            Rows still to check, or needing a fix, arrive <b>in review</b> for a fact-checker here.
          </li>
          <li>Rejected rows, rows already in the game and copies of another question are skipped.</li>
        </ul>
      </div>
      <ImportForm canPublish={me.permissions.includes('content.publish')} />
    </>
  );
}
