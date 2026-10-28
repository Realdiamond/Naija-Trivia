/** Start a duel with a random opponent (TRD FR-DUEL-6): a player near your rating, or the Sabi Bot. */
import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { randomId } from '../../platform/random';
import { duelKeys, duels } from './api';

export function useRandomDuel(open: 'push' | 'replace' = 'push') {
  const t = useT();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept until a duel starts, so retrying after a lost response never starts a second one.
  const key = useRef<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    key.current ??= randomId(16);
    try {
      const { duel } = await duels.create({ random: true }, key.current);
      key.current = null;
      queryClient.setQueryData(duelKeys.one(duel.id), duel);
      void queryClient.invalidateQueries({ queryKey: duelKeys.all });
      router[open](`/duel/${duel.id}`);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  return { start, busy, error };
}
