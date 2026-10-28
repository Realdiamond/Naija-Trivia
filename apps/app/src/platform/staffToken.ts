/** No staff sessions in the browser: staff use the console there. */
export const staffToken = {
  get: async (): Promise<string | null> => null,
  set: async (_value: string): Promise<void> => {},
  clear: async (): Promise<void> => {},
};
