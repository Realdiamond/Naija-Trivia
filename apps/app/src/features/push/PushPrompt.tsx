/**
 * Asking for push permission when it makes sense (the timing is an experiment, doc 13 §4):
 * after a turn ("we'll tell you when they play") or a Daily ("get tomorrow's"), never on first
 * open. Our card comes first, so the system prompt only appears for players who want it;
 * "Not now" waits a week before asking again.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { enablePush, pushPermission, pushSupported } from '../../platform/push';
import { storage } from '../../platform/storage';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

const DISMISSED_KEY = 'push.dismissedAt';
const ASK_AGAIN_MS = 7 * 24 * 3_600_000;

export function PushPrompt({ reason, name }: { reason: 'duel' | 'daily'; name?: string }) {
  const t = useT();
  const [state, setState] = useState<'hidden' | 'ask' | 'denied'>('hidden');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    let live = true;
    void (async () => {
      const dismissed = Number((await storage.getItem(DISMISSED_KEY)) ?? 0);
      if (Date.now() - dismissed < ASK_AGAIN_MS) return;
      if (live && (await pushPermission()) === 'undetermined') setState('ask');
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state === 'hidden') return null;

  const turnOn = async () => {
    setBusy(true);
    const result = await enablePush().catch(() => 'denied' as const);
    setBusy(false);
    setState(result === 'granted' ? 'hidden' : 'denied');
  };
  const notNow = () => {
    void storage.setItem(DISMISSED_KEY, String(Date.now()));
    setState('hidden');
  };

  return (
    <View style={styles.card} testID="push-prompt">
      <View style={styles.head}>
        <Icon name="bell" color={colors.primaryInk} />
        <Text variant="heading" style={styles.title}>
          {reason === 'duel' ? t('push.duelTitle') : t('push.dailyTitle')}
        </Text>
      </View>
      {state === 'denied' ? (
        <Text variant="bodySoft">{t('push.denied')}</Text>
      ) : (
        <>
          <Text variant="bodySoft">
            {reason === 'duel' ? t('push.duelBody', { name: name ?? '' }) : t('push.dailyBody')}
          </Text>
          <View style={styles.row}>
            <Button
              label={t('push.turnOn')}
              size="medium"
              loading={busy}
              onPress={() => void turnOn()}
              style={styles.grow}
              testID="push-turn-on"
            />
            <Button label={t('push.notNow')} variant="link" size="medium" onPress={notNow} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.primaryTint,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
});
