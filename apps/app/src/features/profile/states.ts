import { STATE_NAMES, type HomeState } from '@whosabi/shared-types';

export { STATE_NAMES };

export const STATES_BY_NAME = (Object.entries(STATE_NAMES) as Array<[HomeState, string]>).sort((a, b) =>
  a[1].localeCompare(b[1]),
);
