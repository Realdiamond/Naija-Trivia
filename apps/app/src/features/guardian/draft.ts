/**
 * What a 13–17 player typed on the profile screen while their parent or guardian is asked
 * (step 2.8d), so it isn't lost: kept in memory only, and saved once they agree.
 */
import { create } from 'zustand';
import type { HomeState } from '@whosabi/shared-types';

export interface ProfileDraft {
  username: string;
  avatar_id: string;
  home_state: HomeState | null;
}

export const useProfileDraft = create<{ draft: ProfileDraft | null }>(() => ({ draft: null }));
