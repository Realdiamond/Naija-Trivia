/** Identifiers as staff see them by default (doc 18 §7.2): enough to recognise, not to use. */

/** `+2348034564567` → `+234 80• ••• 4567`. */
export function maskPhoneForStaff(e164: string): string {
  if (!/^\+234\d{10}$/.test(e164)) return '•••';
  return `+234 ${e164.slice(4, 6)}• ••• ${e164.slice(-4)}`;
}

export function maskSignIn(provider: string, subject: string): string {
  switch (provider) {
    case 'phone':
      return maskPhoneForStaff(subject);
    case 'guest_device':
      return `device ${subject.slice(0, 4)}…`;
    default:
      return `${provider[0]!.toUpperCase()}${provider.slice(1)} account`;
  }
}

/** For the audit log: what was searched for, without a full phone number in it. */
export function maskSearch(query: string, phone: string | null): string {
  return phone ? maskPhoneForStaff(phone) : query;
}
