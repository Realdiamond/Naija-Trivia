/**
 * Threshold alerts (doc 18 §9 "Reports & alerts", build plan step 2.7m): rules on a metric over
 * the last few minutes, checked every minute; crossing one alerts staff phones (and email or
 * Slack once set up), and so does its coming back to normal. Owners and admins.
 */
import {
  ALERT_METRICS,
  routes,
  type AdminAlertRule,
  type AdminAlertRulesResponse,
} from '@whosabi/shared-types';
import { AdminApiError, adminApi } from '../../../lib/api';
import { watDateTime } from '../../../lib/format';
import { deleteRule, switchRule } from './actions';
import { RuleForm } from './RuleForm';

function sentence(rule: AdminAlertRule): string {
  const metric = ALERT_METRICS[rule.metric];
  const line = metric.ratio ? `${rule.threshold}%` : `${rule.threshold}`;
  const when =
    rule.comparison === 'drop_pct_vs_last_week'
      ? `down ${rule.threshold}% on the same time last week`
      : `${rule.comparison} ${line}`;
  return `${metric.label} ${when}, over the last ${rule.window_minutes} minutes`;
}

function now(rule: AdminAlertRule): string {
  if (!rule.enabled) return 'Switched off';
  if (rule.last_checked_at === null) return 'Not checked yet';
  if (rule.last_value === null) return 'Too little to judge';
  const metric = ALERT_METRICS[rule.metric];
  if (rule.comparison === 'drop_pct_vs_last_week') return `${rule.last_value}% down on last week`;
  return metric.ratio ? `${rule.last_value}%` : `${rule.last_value} ${metric.unit}`;
}

export default async function AlertRules() {
  let page: AdminAlertRulesResponse;
  try {
    page = await adminApi<AdminAlertRulesResponse>(routes.admin.alertRules);
  } catch (e) {
    return (
      <p className="error">{e instanceof AdminApiError ? e.message : 'Could not load the alert rules.'}</p>
    );
  }
  return (
    <>
      <div>
        <h1>Alert rules</h1>
        <p className="muted">
          Each rule is checked every minute. When one is crossed, staff get one alert, and another when it is
          back to normal. Staff phones get them in the Staff tab; email needs Resend and ALERT_EMAILS, Slack
          its webhook.
        </p>
      </div>
      <section className="card">
        <h2>Rules</h2>
        {page.rules.length === 0 ? (
          <p className="muted small">
            No rules yet. A good first one: sign-in codes verified below 85% over 15 minutes.
          </p>
        ) : (
          <table data-testid="rules">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Now</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.rules.map((rule) => (
                <tr key={rule.id} data-testid={`rule-${rule.id}`}>
                  <td>
                    {rule.name ? <b>{rule.name}</b> : null}
                    <div className={rule.name ? 'muted small' : undefined}>{sentence(rule)}</div>
                    <div className="muted small">To {rule.channels.join(', ')}</div>
                  </td>
                  <td>{now(rule)}</td>
                  <td>
                    {rule.firing_since ? (
                      <span className="badge warn">Crossed since {watDateTime(rule.firing_since)}</span>
                    ) : rule.enabled ? (
                      <span className="badge">Fine</span>
                    ) : (
                      <span className="badge off">Off</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <form action={switchRule.bind(null, rule.id, !rule.enabled)}>
                        <button type="submit" className="small">
                          {rule.enabled ? 'Switch off' : 'Switch on'}
                        </button>
                      </form>
                      <form action={deleteRule.bind(null, rule.id)}>
                        <button type="submit" className="small danger">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>Add a rule</h2>
        <RuleForm channels={page.channels} />
      </section>
    </>
  );
}
