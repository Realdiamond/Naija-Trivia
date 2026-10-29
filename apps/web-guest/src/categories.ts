/** The packs' names and colours (doc 05 §7), as in the app. */
export const CATEGORIES: Record<string, { name: string; color: string }> = {
  slang: { name: 'Slang & Pidgin', color: '#8E44AD' },
  nollywood: { name: 'Nollywood', color: '#E67E22' },
  music: { name: 'Music', color: '#2980B9' },
  food: { name: 'Food', color: '#C0392B' },
  sport: { name: 'Sport', color: '#B8860B' },
  mixed: { name: 'Mixed Naija', color: '#16A085' },
};

export const category = (id: string) => CATEGORIES[id] ?? { name: id, color: '#5A6660' };
