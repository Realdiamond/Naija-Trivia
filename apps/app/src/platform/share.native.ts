import { Share } from 'react-native';

/** The phone's share sheet. */
export const canShare = true;

export async function shareText(text: string, _url: string): Promise<boolean> {
  const result = await Share.share({ message: text });
  return result.action === Share.sharedAction;
}
