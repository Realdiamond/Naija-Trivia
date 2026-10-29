/**
 * Data Saver (PRD F15, UX §4, build plan step 2.8b): the player's choice, or automatic, on when
 * the phone or browser says data is tight (Save-Data, 2G or 3G). While it's on:
 * - ads between games wait for Wi-Fi and the results banner stays away; rewarded videos are
 *   the player's own pick, so they still play;
 * - analytics go out every 2 minutes instead of every 30 seconds (doc 18 §15).
 * Questions are text-only already (none has a picture yet) and the app plays no animations
 * that download anything, so nothing else has to change for now.
 *
 * The choice is kept on the device as well, so it applies from the first screen; the profile's
 * `data_saver` takes over once it loads.
 */
import { create } from 'zustand';
import type { Me } from '@whosabi/shared-types';
import { queryClient } from '../../api/queryClient';
import { watchConnection } from '../../platform/connection';
import { storage } from '../../platform/storage';
import { dataSaverOn, type DataSaverState } from './rules';

const KEY = 'data_saver';

export const useDataSaver = create<DataSaverState & { fromProfile: boolean }>(() => ({
  choice: null,
  slow: false,
  wifi: false,
  fromProfile: false,
}));

/** Whether Data Saver is on now, for code outside React. */
export const isDataSaverOn = (): boolean => dataSaverOn(useDataSaver.getState());

function remember(choice: boolean | null): void {
  void (choice === null ? storage.removeItem(KEY) : storage.setItem(KEY, choice ? 'on' : 'off'));
}

/** The player picked on or off, or automatic (null). Settings saves it to the profile too. */
export function chooseDataSaver(choice: boolean | null): void {
  useDataSaver.setState({ choice });
  remember(choice);
}

/** At start-up: the saved choice, the connection, and the profile whenever it loads. */
export function startDataSaver(): () => void {
  void storage.getItem(KEY).then((saved) => {
    if (useDataSaver.getState().fromProfile) return;
    if (saved === 'on' || saved === 'off') useDataSaver.setState({ choice: saved === 'on' });
  });
  const stopWatching = watchConnection((info) => useDataSaver.setState(info));
  const stopSyncing = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryKey.length !== 1 || event.query.queryKey[0] !== 'me') {
      return;
    }
    const me = event.query.state.data as Me | undefined;
    if (!me) return;
    if (useDataSaver.getState().choice !== me.data_saver) remember(me.data_saver);
    useDataSaver.setState({ choice: me.data_saver, fromProfile: true });
  });
  return () => {
    stopWatching();
    stopSyncing();
  };
}
