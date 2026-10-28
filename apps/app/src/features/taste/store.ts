import { create } from 'zustand';

export interface TasteItem {
  categoryId: string;
  /** The "Did you know?" line, or the question when there is none. */
  line: string;
  correct: boolean;
  points: number;
}

export interface TasteSummary {
  correct: number;
  total: number;
  score: number;
  items: TasteItem[];
}

/** The last taste test, kept in memory for the result screen. */
export const useTasteResult = create<{ summary: TasteSummary | null }>(() => ({ summary: null }));
