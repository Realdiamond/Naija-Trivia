/**
 * Nigerian mobile numbers in E.164 (+234…): the only numbers accepted at launch (doc 10 §1).
 * Shared by the API and the apps, which hash this same form for contact discovery
 * (TRD FR-SOC-2), so a number always means the same thing on both sides.
 */
const NIGERIAN_MOBILE = /^[789][01]\d{8}$/;

/**
 * '0803 123 4567', '+234 803 123 4567', '2348031234567' or '00234…' → '+2348031234567'.
 * Null when it is not a Nigerian mobile number.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, '');
  let national: string;
  if (/^\+234\d+$/.test(compact)) national = compact.slice(4);
  else if (/^00234\d+$/.test(compact)) national = compact.slice(5);
  else if (/^234\d{10,11}$/.test(compact)) national = compact.slice(3);
  else if (/^\d+$/.test(compact)) national = compact;
  else return null;
  // The trunk 0 is often kept after the country code: +234 0803…
  if (national.startsWith('0')) national = national.slice(1);
  return NIGERIAN_MOBILE.test(national) ? `+234${national}` : null;
}

/** For logs and support screens: +234803****567. */
export function maskPhone(e164: string): string {
  return e164.length > 10 ? `${e164.slice(0, 7)}****${e164.slice(-3)}` : '****';
}
