import { Platform, useWindowDimensions } from 'react-native';

/** A computer screen: from 1024 px wide on the web the side navigation shows (TRD FR-WEB-4). */
export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 1024;
}
