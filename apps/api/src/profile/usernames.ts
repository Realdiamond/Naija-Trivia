/**
 * Which usernames are allowed (doc 10 §1: profanity filters in English, Pidgin, Yoruba, Igbo
 * and Hausa; doc 16: moderators can force a rename). This is a starter list for the moderation
 * team to extend. Checks ignore case, underscores, look-alike characters (sh1t, @ss) and
 * stretched letters (fuuuck). Mild banter (mumu, olodo, werey) is allowed on purpose.
 */

/** Names that would look official, or claim the brand. Checked as the start of the name. */
const RESERVED = ['admin', 'moderator', 'support', 'staff', 'official', 'sabibot'];
/** The brand, anywhere in the name. */
const BRAND = ['whosabi'];
/** Offensive wherever they appear inside a name. */
// prettier-ignore
const ANYWHERE = [
  'fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'porn', 'pussy', 'penis', 'vagina',
  'bastard', 'asshole', 'dickhead', 'hitler',
  // Pidgin, Yoruba, Hausa
  'ashawo', 'ashewo', 'olosho', 'shege', 'daniska',
];
/** Offensive only as a whole word, so "classic", "peacock", "Dickson", "Nazir" and "therapist" stay fine. */
const WHOLE_WORD = ['ass', 'cock', 'dick', 'fag', 'rape', 'rapist', 'sex', 'tits', 'hoe', 'nazi'];

// prettier-ignore
const LOOK_ALIKES: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i',
};

export type UsernameCheck = { ok: true } | { ok: false; reason: 'reserved' | 'offensive' };

export function checkUsername(username: string): UsernameCheck {
  const lower = username.toLowerCase();
  const plain = [...lower].map((c) => LOOK_ALIKES[c] ?? c).join('');
  const joined = plain.replace(/_/g, '');
  const squeezed = joined.replace(/(.)\1+/g, '$1');
  const words = plain.split(/[^a-z]+/).filter(Boolean);

  if (RESERVED.some((r) => joined.startsWith(r)) || BRAND.some((b) => joined.includes(b))) {
    return { ok: false, reason: 'reserved' };
  }
  const anywhere = (term: string) =>
    joined.includes(term) || squeezed.includes(term.replace(/(.)\1+/g, '$1'));
  if (ANYWHERE.some(anywhere) || words.some((w) => WHOLE_WORD.includes(w))) {
    return { ok: false, reason: 'offensive' };
  }
  return { ok: true };
}
