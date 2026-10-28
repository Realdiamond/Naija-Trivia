'use client';
/**
 * Import a CSV in two steps: check it (nothing is saved), then import. Errors and warnings are
 * listed by line, so the file can be fixed in the question bank and tried again.
 */
import { useState, useTransition } from 'react';
import type { AdminImportResponse } from '@whosabi/shared-types';
import { STATUS_LABEL } from '../../../lib/content';
import { importCsv } from '../questions/actions';

export function ImportForm({ canPublish }: { canPublish: boolean }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [publish, setPublish] = useState(false);
  const [result, setResult] = useState<AdminImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (dryRun: boolean) =>
    start(async () => {
      if (!csv) return;
      const reply = await importCsv(csv, dryRun, publish);
      setResult(reply.result);
      setError(reply.error);
    });

  const total = result ? Object.values(result.created).reduce((a, b) => a + b, 0) : 0;
  const created = result
    ? Object.entries(result.created)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${n} ${STATUS_LABEL[s as keyof typeof STATUS_LABEL].toLowerCase()}`)
        .join(', ')
    : '';

  return (
    <div className="stack">
      <div className="card stack">
        <label>
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="import-file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setResult(null);
              setError(null);
              setFileName(file?.name ?? '');
              setCsv(file ? await file.text() : null);
            }}
          />
        </label>
        {canPublish ? (
          <label className="check">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish
            the rows already approved in the question bank
          </label>
        ) : null}
        <div className="row">
          <button
            type="button"
            disabled={!csv || pending}
            onClick={() => run(true)}
            data-testid="import-check"
          >
            Check the file
          </button>
          {result?.dry_run && total > 0 ? (
            <button
              type="button"
              className="primary"
              disabled={pending}
              onClick={() => run(false)}
              data-testid="import-run"
            >
              Import {total} questions
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <div className="card stack" data-testid="import-result">
          <h2>
            {result.dry_run ? `Checked ${fileName}` : `Imported ${fileName}`}: {result.rows} rows
          </h2>
          <p className={result.dry_run ? '' : 'ok'}>
            {total > 0
              ? `${result.dry_run ? 'Would add' : 'Added'} ${total}: ${created}.`
              : 'Nothing new to add.'}{' '}
            {result.skipped > 0
              ? `${result.skipped} skipped (already in the game, rejected, or a copy).`
              : ''}
          </p>
          {result.errors.length > 0 ? (
            <>
              <h3>{result.errors.length} problems: these rows are left out</h3>
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Id</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((p, i) => (
                    <tr key={i}>
                      <td>{p.line}</td>
                      <td className="mono">{p.ref}</td>
                      <td>{p.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {result.warnings.length > 0 ? (
            <>
              <h3>{result.warnings.length} to look at</h3>
              <table>
                <tbody>
                  {result.warnings.map((p, i) => (
                    <tr key={i}>
                      <td>{p.line || ''}</td>
                      <td className="mono">{p.ref}</td>
                      <td>{p.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
