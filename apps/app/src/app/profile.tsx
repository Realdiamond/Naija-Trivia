/**
 * The Profile tab (UX §1, PRD F2, build plan step 2.11): who the player is (avatar, name, tier,
 * level and XP), how they play (duels, the Daily streak, party and practice games, right answers
 * by category), changing their avatar or home state, and the way to friends, coins, settings and
 * help. A guest is offered to save their progress.
 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type HomeState, type Me, type MyStats } from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { useSession } from '../auth/session';
import { SignInOptions } from '../features/auth/SignInOptions';
import { STATE_NAMES, STATES_BY_NAME } from '../features/profile/states';
import { useT, type MessageKey } from '../i18n';
import { Avatar, AVATARS } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { category, colors, radius } from '../ui/theme';

export default function Profile() {
  const t = useT();
  const { status, user } = useSession();
  const signedIn = status === 'guest' || status === 'account';
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>(routes.me()), enabled: signedIn });
  const stats = useQuery({
    queryKey: ['me', 'stats'],
    queryFn: () => api.get<MyStats>(routes.meStats()),
    enabled: signedIn,
  });
  const [editing, setEditing] = useState(false);

  if (status === 'signed_out') return <Redirect href="/welcome" />;
  if (!me.data) {
    return (
      <Screen>
        {me.isError ? (
          <View style={styles.center}>
            <Text variant="body" align="center">
              {errorMessage(me.error, t('error.network'))}
            </Text>
            <Button label={t('error.retry')} variant="outline" onPress={() => void me.refetch()} />
          </View>
        ) : (
          <ActivityIndicator style={styles.center} color={colors.primary} size="large" />
        )}
      </Screen>
    );
  }
  const profile = me.data;
  const s = stats.data;

  return (
    <Screen>
      <View style={styles.hero}>
        <Avatar id={profile.avatar_id} size={88} />
        <Text variant="title" testID="me-name">
          {profile.username ?? user?.username ?? t('me.guest')}
        </Text>
        <Text variant="label" color={colors.primaryInk} testID="me-tier">
          {profile.tier.badge} {profile.tier.name} · {t('me.rating', { rating: Math.round(profile.rating) })}
        </Text>
        {profile.home_state ? <Text variant="caption">{STATE_NAMES[profile.home_state]}</Text> : null}
        <View style={styles.level}>
          <Text variant="label">{t('me.level', { level: profile.level })}</Text>
          <View style={styles.bar}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.min(100, Math.round((profile.xp_into_level / profile.xp_for_next_level) * 100))}%`,
                },
              ]}
            />
          </View>
          <Text variant="caption">
            {t('me.xp', {
              into: profile.xp_into_level.toLocaleString('en-NG'),
              next: profile.xp_for_next_level.toLocaleString('en-NG'),
              level: profile.level + 1,
            })}
          </Text>
        </View>
        <Button
          label={t('me.edit')}
          variant="link"
          size="medium"
          onPress={() => setEditing(true)}
          testID="me-edit"
        />
      </View>

      <Text variant="heading" style={styles.section}>
        {t('me.stats')}
      </Text>
      {s ? (
        <View style={styles.grid} testID="me-stats">
          <Stat
            label="me.duels"
            value={s.duels.played}
            line={t('me.duelsLine', { won: s.duels.won, lost: s.duels.lost, drawn: s.duels.drawn })}
          />
          <Stat
            label="me.daily"
            value={s.daily.streak}
            line={t('me.dailyLine', { best: s.daily.best_streak, played: s.daily.played })}
          />
          <Stat label="me.party" value={s.party.won} line={t('me.partyLine', { played: s.party.played })} />
          <Stat label="me.practice" value={s.practice.games} />
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}

      <Text variant="heading" style={styles.section}>
        {t('me.categories')}
      </Text>
      {s && s.categories.length === 0 ? <Text variant="bodySoft">{t('me.categoriesEmpty')}</Text> : null}
      {s?.categories.map((c) => {
        const share = c.answered > 0 ? c.correct / c.answered : 0;
        return (
          <View key={c.category_id} style={styles.category} testID={`me-category-${c.category_id}`}>
            <View style={styles.categoryHead}>
              <Text variant="label" style={styles.grow}>
                {category(c.category_id).name}
              </Text>
              <Text variant="label">{Math.round(share * 100)}%</Text>
            </View>
            <View style={styles.bar}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.round(share * 100)}%`, backgroundColor: category(c.category_id).color },
                ]}
              />
            </View>
            <Text variant="caption">{t('me.right', { correct: c.correct, answered: c.answered })}</Text>
          </View>
        );
      })}

      <View style={styles.links}>
        {status === 'account' ? <LinkRow icon="users" label="me.friends" path="/friends" /> : null}
        <LinkRow icon="coin" label="me.coins" path="/coins" />
        <LinkRow icon="settings" label="me.settings" path="/settings" />
        <LinkRow icon="search" label="me.help" path="/help" />
      </View>

      {status === 'guest' ? (
        <View style={styles.save}>
          <Text variant="heading">{t('home.saveTitle')}</Text>
          <Text variant="bodySoft">{t('home.saveBody')}</Text>
          <SignInOptions />
        </View>
      ) : null}

      {editing ? <EditProfile me={profile} onClose={() => setEditing(false)} /> : null}
    </Screen>
  );
}

function Stat({ label, value, line }: { label: MessageKey; value: number; line?: string }) {
  const t = useT();
  return (
    <View style={styles.stat}>
      <Text variant="caption">{t(label)}</Text>
      <Text variant="title">{value.toLocaleString('en-NG')}</Text>
      {line ? <Text variant="caption">{line}</Text> : null}
    </View>
  );
}

function LinkRow({ icon, label, path }: { icon: IconName; label: MessageKey; path: string }) {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(path)}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      testID={`me-link-${path.slice(1)}`}
    >
      <Icon name={icon} size={20} color={colors.inkSoft} />
      <Text variant="body" style={styles.grow}>
        {t(label)}
      </Text>
      <Icon name="chevron-right" size={18} color={colors.inkSoft} />
    </Pressable>
  );
}

/** Changing the avatar or home state; the username is chosen once (support changes it). */
function EditProfile({ me, onClose }: { me: Me; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [avatar, setAvatar] = useState<string | null>(me.avatar_id);
  const [homeState, setHomeState] = useState<HomeState | null>(me.home_state);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<Me>(routes.me(), {
        ...(avatar ? { avatar_id: avatar } : {}),
        home_state: homeState,
      });
      queryClient.setQueryData(['me'], updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('practice.cancel')} />
      <View style={styles.sheet} testID="me-edit-sheet">
        <Text variant="label">{t('profile.avatar')}</Text>
        <View style={styles.avatars} accessibilityRole="radiogroup">
          {AVATARS.map((a) => (
            <Pressable
              key={a.id}
              accessibilityRole="radio"
              accessibilityLabel={a.name}
              accessibilityState={{ selected: avatar === a.id }}
              onPress={() => setAvatar(a.id)}
              style={[styles.avatar, avatar === a.id && styles.avatarChosen]}
              testID={`me-avatar-${a.id}`}
            >
              <Avatar id={a.id} size={44} />
            </Pressable>
          ))}
        </View>
        <Text variant="label">{t('profile.state')}</Text>
        <Pressable accessibilityRole="button" onPress={() => setPicking(!picking)} style={styles.select}>
          <Text variant="body" color={homeState ? colors.ink : colors.muted}>
            {homeState ? STATE_NAMES[homeState] : t('profile.stateNone')}
          </Text>
        </Pressable>
        {picking ? (
          <FlatList
            style={styles.states}
            data={STATES_BY_NAME}
            keyExtractor={([code]) => code}
            renderItem={({ item: [code, name] }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setHomeState(code);
                  setPicking(false);
                }}
                style={styles.option}
              >
                <Text variant="body">{name}</Text>
              </Pressable>
            )}
          />
        ) : null}
        {error ? (
          <Text variant="body" color={colors.wrongInk}>
            {error}
          </Text>
        ) : null}
        <Button label={t('me.save')} onPress={() => void save()} loading={saving} testID="me-save" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { marginTop: 80, gap: 16 },
  hero: { alignItems: 'center', gap: 6 },
  level: { alignSelf: 'stretch', gap: 6, marginTop: 10 },
  bar: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
  section: { marginTop: 24, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  category: { gap: 4, marginBottom: 12 },
  categoryHead: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  links: { marginTop: 16 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  save: {
    borderRadius: radius.card,
    padding: 16,
    gap: 12,
    marginTop: 24,
    backgroundColor: colors.accentTint,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(14, 26, 20, 0.5)' },
  sheet: {
    gap: 12,
    padding: 20,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: colors.bg,
    maxHeight: '85%',
  },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatar: { padding: 3, borderRadius: 30, borderWidth: 3, borderColor: 'transparent' },
  avatarChosen: { borderColor: colors.accent },
  select: {
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  states: { maxHeight: 240 },
  option: { paddingVertical: 12, paddingHorizontal: 8 },
});
