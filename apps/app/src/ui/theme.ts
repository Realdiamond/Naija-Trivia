/** Design tokens (doc 05 §7) as used by the screen designs in docs/design. */
export const colors = {
  primary: '#008751',
  primaryInk: '#006B40',
  primaryTint: '#E3F3EA',
  accent: '#FF7A00',
  gold: '#FFB547',
  accentTint: '#FFF1E3',
  accentInk: '#A84300',
  bg: '#FFFDF7',
  surface: '#FFFFFF',
  sand: '#F3EEE1',
  ink: '#14231B',
  inkSoft: '#3F4A44',
  muted: '#5A6660',
  border: '#E8E2D2',
  borderStrong: '#D9D1BE',
  /** The outline of a text box or picker at rest: 3.5:1 on white, so the field itself is seen (WCAG 1.4.11). */
  inputBorder: '#858B80',
  correct: '#1DB954',
  correctInk: '#0B6B33',
  correctTint: '#E6F7EC',
  wrong: '#E5383B',
  wrongInk: '#B3191C',
  wrongTint: '#FDE8E8',
  night: '#0E1A14',
  white: '#FFFFFF',
} as const;

/** Category colours (doc 05 §7); a dot or band, never behind text. */
export const categoryColors: Record<
  string,
  { color: string; tint: string; name: string; short: string; emoji: string; blurb: string }
> = {
  slang: {
    color: '#8E44AD',
    tint: '#F2E8F7',
    name: 'Slang & Pidgin',
    short: 'Slang',
    emoji: '💬',
    blurb: 'Pidgin, slang, street talk',
  },
  nollywood: {
    color: '#E67E22',
    tint: '#FCEBDB',
    name: 'Nollywood',
    short: 'Nolly',
    emoji: '🎬',
    blurb: 'Films, stars, famous lines',
  },
  music: {
    color: '#2980B9',
    tint: '#E4EEF8',
    name: 'Music',
    short: 'Music',
    emoji: '🎵',
    blurb: 'Afrobeats, hooks, legends',
  },
  food: {
    color: '#C0392B',
    tint: '#FBE6E3',
    name: 'Food',
    short: 'Food',
    emoji: '🍲',
    blurb: 'Swallow, soups, street food',
  },
  sport: {
    color: '#B8860B',
    tint: '#F8EFD6',
    name: 'Sport',
    short: 'Sport',
    emoji: '⚽',
    blurb: 'Football, athletes, big moments',
  },
  mixed: {
    color: '#16A085',
    tint: '#DFF3EE',
    name: 'Mixed Naija',
    short: 'Mixed',
    emoji: '⭐',
    blurb: 'History, places, a bit of everything',
  },
};

export const category = (id: string | null | undefined) =>
  categoryColors[id ?? ''] ?? {
    color: colors.muted,
    tint: colors.sand,
    name: id ?? '',
    short: id ?? '',
    emoji: '❓',
    blurb: '',
  };

export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  heavy: 'Nunito_800ExtraBold',
  display: 'Baloo2_800ExtraBold',
} as const;

export const radius = { card: 16, button: 12, pill: 999 } as const;

/** Phone-width column, centred on bigger screens (TRD FR-WEB-4). */
export const CONTENT_MAX_WIDTH = 480;
