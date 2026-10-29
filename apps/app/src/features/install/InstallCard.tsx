/**
 * "Put Who Sabi? on your home screen" (UX §3, TRD FR-WEB-3), on Home in the web app from the
 * second visit on this device, never during a game. "Not now" waits a week before asking again.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { sessionsHere } from '../../ads/pacing';
import { useT } from '../../i18n';
import { promptInstall, useInstall } from '../../platform/install';
import { storage } from '../../platform/storage';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

const DISMISSED_KEY = 'install.dismissedAt';
const ASK_AGAIN_MS = 7 * 24 * 3_600_000;

export function InstallCard() {
  const t = useT();
  const way = useInstall((s) => s.way);
  const [due, setDue] = useState(false);

  useEffect(() => {
    if (!way) return;
    let live = true;
    void (async () => {
      const dismissed = Number((await storage.getItem(DISMISSED_KEY)) ?? 0);
      if (Date.now() - dismissed < ASK_AGAIN_MS || (await sessionsHere()) < 2) return;
      if (live) setDue(true);
    })();
    return () => {
      live = false;
    };
  }, [way]);

  if (!way || !due) return null;

  const notNow = () => {
    void storage.setItem(DISMISSED_KEY, String(Date.now()));
    setDue(false);
  };

  return (
    <View style={styles.card} testID="install-card">
      <View style={styles.head}>
        <Icon name="download" color={colors.primaryInk} />
        <Text variant="heading" style={styles.title}>
          {t('install.title')}
        </Text>
      </View>
      <Text variant="bodySoft">{way === 'ios' ? t('install.iosSteps') : t('install.body')}</Text>
      <View style={styles.row}>
        {way === 'prompt' ? (
          <Button
            label={t('install.button')}
            size="medium"
            onPress={() => void promptInstall()}
            style={styles.grow}
            testID="install-app"
          />
        ) : null}
        <Button
          label={t('install.later')}
          variant="link"
          size="medium"
          onPress={notNow}
          testID="install-later"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 16, borderRadius: radius.card, backgroundColor: colors.primaryTint },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
});
