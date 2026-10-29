/** Pieces the party screens share: the room clock, toasts, the QR code and player labels. */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import type { PartyPlayer } from '@whosabi/shared-types';
import { useT, type MessageKey } from '../../i18n';
import { Avatar, InitialAvatar } from '../../ui/Avatar';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';
import { party } from './api';
import type { PartyView } from './useParty';

/** Milliseconds left until `endsAt` on the server's clock, ticking every 100 ms. */
export function useTimeLeft(endsAt: number, serverNow: () => number): number {
  const [left, setLeft] = useState(() => Math.max(0, endsAt - serverNow()));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, endsAt - serverNow()));
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [endsAt, serverNow]);
  return endsAt === 0 ? 0 : left;
}

/** "Chidi joined", for three seconds. */
export function PartyToast({ toast }: { toast: PartyView['toast'] }) {
  const t = useT();
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast.id);
    const timer = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast || shown !== toast.id) return null;
  return (
    <View style={styles.toast} accessibilityLiveRegion="polite" pointerEvents="none">
      <Text variant="label" color={colors.white}>
        {t(`party.toast.${toast.kind}` as MessageKey, { name: toast.name })}
      </Text>
    </View>
  );
}

export function RoomQr({ code, size = 120 }: { code: string; size?: number }) {
  const qr = useQuery({ queryKey: ['party-qr', code], queryFn: () => party.qr(code), staleTime: Infinity });
  return (
    <View style={[styles.qr, { width: size + 16, height: size + 16 }]}>
      {qr.data ? <SvgXml xml={qr.data} width={size} height={size} /> : null}
    </View>
  );
}

export function PlayerAvatar({
  player,
  size = 44,
}: {
  player: Pick<PartyPlayer, 'name' | 'avatar_id'>;
  size?: number;
}) {
  return player.avatar_id ? (
    <Avatar id={player.avatar_id} size={size} />
  ) : (
    <InitialAvatar name={player.name} size={size} />
  );
}

export function useKindLabel() {
  const t = useT();
  return (kind: PartyPlayer['kind']) => t(`party.kind.${kind}` as MessageKey);
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    // Low on the screen, clear of the lobby's code and the question.
    bottom: 120,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    zIndex: 10,
  },
  qr: {
    backgroundColor: colors.white,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
