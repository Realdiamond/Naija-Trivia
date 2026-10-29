/** Where the light client sends people next: the full web app, or the app on Google Play. */
export const PLAY_STORE = 'https://play.google.com/store/apps/details?id=ng.whosabi.app';

/** The same room in the full web app, where a signed-in player joins as themselves. */
export const fullApp = (code: string) => `/r/${code}?app=1`;

export const whatsapp = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
