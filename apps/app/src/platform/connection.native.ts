/**
 * What the phone says about the connection (NetInfo): 2G or 3G mobile data means data is tight
 * (UX §4). Android tells the generation without any extra permission.
 */
import NetInfo, { NetInfoStateType, type NetInfoState } from '@react-native-community/netinfo';
import type { ConnectionInfo } from './connection';

export type { ConnectionInfo } from './connection';

function toInfo(state: NetInfoState): ConnectionInfo {
  const generation = state.type === NetInfoStateType.cellular ? state.details.cellularGeneration : null;
  return {
    slow: generation === '2g' || generation === '3g',
    wifi: state.type === NetInfoStateType.wifi || state.type === NetInfoStateType.ethernet,
  };
}

/** Calls `onChange` with the current connection and whenever it changes; returns a stop function. */
export function watchConnection(onChange: (info: ConnectionInfo) => void): () => void {
  // NetInfo calls the listener straight away with the current state.
  return NetInfo.addEventListener((state) => onChange(toInfo(state)));
}
