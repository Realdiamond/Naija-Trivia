import { routes, type PingResponse, type PongResponse } from '@whosabi/shared-types';
import { api } from '../../api';

/**
 * One round-trip sample for the answer-timing clamp (TRD §5.3): ask for a ping and answer it
 * straight away; the server times both ends. Best effort: a failed sample changes nothing.
 */
export async function sampleRtt(): Promise<void> {
  try {
    const ping = await api.post<PingResponse>(routes.ping());
    await api.post<PongResponse>(routes.pong(ping.ping_id));
  } catch {
    // The server falls back to its default estimate.
  }
}
