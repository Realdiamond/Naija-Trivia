/**
 * Home (mockup 08). For now: who you are, saving your progress, and the taste test again.
 * Step 1.4b adds "Your turn", "Waiting on them", challenges and the tab bar.
 */
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { routes, type Me } from '@whosabi/shared-types';
import { api } from '../api';
import { signOut, useSession } from '../auth/session';
import { SignInOptions } from '../features/auth/SignInOptions';
import { useT } from '../i18n';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

export default function Home() {
  const t = useT();
  const { status, user } = useSession();
  const signedIn = status === 'guest' || status === 'account';
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>(routes.me()), enabled: signedIn });

  if (status === 'signed_out') return <Redirect href="/welcome" />;
  if (status === 'account' && user && !user.username) return <Redirect href="/profile-setup" />;

  const name = user?.username ?? t('home.guestName');
  const level = me.data?.level ?? user?.level ?? 1;

  return (
    <Screen>
      <View style={styles.header}>
        <Avatar id={me.data?.avatar_id} size={52} />
        <View style={styles.headerText}>
          <Text variant="heading" testID="greeting">
            {t('home.greeting', { name })}
          </Text>
          <Text variant="caption">
            {t('home.level', { level })}
            {me.data ? ` · ${me.data.tier.name}` : ''}
          </Text>
        </View>
      </View>

      {status === 'guest' ? (
        <View style={[styles.card, styles.save]}>
          <Text variant="heading">{t('home.saveTitle')}</Text>
          <Text variant="bodySoft">{t('home.saveBody')}</Text>
          <SignInOptions />
        </View>
      ) : null}

      <View style={[styles.card, styles.soon]}>
        <Icon name="swords" color={colors.primaryInk} size={28} />
        <Text variant="body" style={styles.soonText}>
          {t('home.duelsSoon')}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label={t('home.playAgain')}
          variant="outline"
          icon="play"
          onPress={() => router.push('/taste')}
          testID="play-again"
        />
        {status === 'account' ? (
          <Button
            label={t('home.signOut')}
            variant="link"
            icon="logout"
            onPress={() => void signOut().then(() => router.replace('/welcome'))}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  headerText: { flex: 1, gap: 2 },
  card: { borderRadius: radius.card, padding: 16, gap: 12, marginBottom: 16 },
  save: { backgroundColor: colors.accentTint },
  soon: { backgroundColor: colors.primaryTint, flexDirection: 'row', alignItems: 'center' },
  soonText: { flex: 1 },
  actions: { gap: 8 },
});
