/**
 * LiveOps (doc 18 §11, build plan step 2.7c): flags and kill switches, and the in-app status
 * banner. Apps look again every 45 seconds, so a change reaches every player within a minute
 * (AD-7); switching a kill switch is announced in the staff alerts.
 */
import {
  routes,
  type AdminBannerResponse,
  type AdminFlag,
  type AdminFlagsResponse,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import { BannerForm, FlagForm } from './Forms';

function who(flag: AdminFlag): string {
  if (!flag.enabled) return 'Off for everyone';
  const rule = flag.rules[0];
  if (!rule) return 'On for everyone';
  const parts = [
    rule.platform ? `on ${rule.platform}` : null,
    rule.min_app_version ? `from version ${rule.min_app_version}` : null,
    rule.percent !== undefined ? `${rule.percent}% of players` : null,
  ].filter(Boolean);
  return `On ${parts.join(', ')}`;
}

export default async function LiveOps() {
  let flags: AdminFlagsResponse;
  let banner: AdminBannerResponse;
  try {
    [flags, banner] = await Promise.all([
      adminApi<AdminFlagsResponse>(routes.admin.flags()),
      adminApi<AdminBannerResponse>(routes.admin.banner()),
    ]);
  } catch (e) {
    return <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load LiveOps.'}</p>;
  }
  return (
    <>
      <div>
        <h1>LiveOps</h1>
        <p className="muted">
          Changes reach every player within a minute. Each one needs a reason and is logged.
        </p>
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Flags and kill switches</h2>
          <div className="stack">
            {flags.flags.map((flag) => (
              <article key={flag.key} className="flag">
                <div className="row spread">
                  <div>
                    <h3>
                      {flag.description}{' '}
                      {flag.kill_switch ? <span className="badge off">kill switch</span> : null}
                    </h3>
                    <p className="mono muted small">{flag.key}</p>
                  </div>
                  <span
                    className={flag.enabled ? 'badge' : 'badge warn'}
                    data-testid={`flag-state-${flag.key.replaceAll('.', '-')}`}
                  >
                    {who(flag)}
                  </span>
                </div>
                <p className="muted small">
                  {flag.updated_by
                    ? `Changed by ${flag.updated_by}, ${watDateTime(flag.updated_at)}`
                    : 'Not changed yet'}
                </p>
                <details>
                  <summary data-testid={`flag-change-${flag.key.replaceAll('.', '-')}`}>Change</summary>
                  <FlagForm flag={flag} />
                </details>
              </article>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Status banner</h2>
          {banner.banner ? (
            <p
              className={banner.banner.level === 'warning' ? 'banner-preview warn' : 'banner-preview'}
              data-testid="banner-now"
            >
              {banner.banner.text_en}
            </p>
          ) : (
            <p className="muted small" data-testid="banner-none">
              No banner showing in the app.
            </p>
          )}
          {banner.updated_by ? (
            <p className="muted small">
              Last changed by {banner.updated_by}, {watDateTime(banner.updated_at)}
            </p>
          ) : null}
          <BannerForm banner={banner.banner} />
        </section>
      </div>
    </>
  );
}
