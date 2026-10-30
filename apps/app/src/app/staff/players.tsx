/** Player lookup in the Staff tab: by username, user id, duel id or device id (doc 18 §7.1). */
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { routes, type AdminUserSearchResponse } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { StaffGate } from '../../features/staff/StaffGate';
import { staffGet } from '../../features/staff/session';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, fonts, radius } from '../../ui/theme';

export default function StaffPlayers() {
  return (
    <StaffGate>
      <Search />
    </StaffGate>
  );
}

function Search() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['staff', 'players', q],
    queryFn: () => staffGet<AdminUserSearchResponse>(routes.admin.users(q)),
    enabled: q.length >= 2,
  });

  return (
    <Screen back backTo="/staff">
      <Text variant="title">Look up a player</Text>
      <View style={styles.searchRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => setQ(text.trim())}
          placeholder="Username, email, phone or an ID"
          placeholderTextColor={colors.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
          testID="staff-search"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={() => setQ(text.trim())}
          style={styles.go}
        >
          <Icon name="search" color={colors.white} />
        </Pressable>
      </View>
      {results.error ? (
        <Text variant="body" color={colors.wrongInk}>
          {errorMessage(results.error, 'Could not search. Check your connection.')}
        </Text>
      ) : null}
      {results.data?.users.length === 0 ? <Text variant="bodySoft">Nobody found.</Text> : null}
      {results.data?.users.map((u) => (
        <Pressable
          key={u.id}
          accessibilityRole="button"
          onPress={() => router.push(`/staff/player/${u.id}`)}
          style={styles.row}
        >
          <View style={styles.grow}>
            <Text variant="label">{u.username ?? (u.status === 'guest' ? 'Guest' : 'No username')}</Text>
            <Text variant="caption">
              {u.status} · level {u.level} · found by {u.matched.replace('_', ' ')}
            </Text>
          </View>
          <Icon name="chevron-right" color={colors.inkSoft} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    borderRadius: radius.button + 4,
    backgroundColor: colors.surface,
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.ink,
  },
  go: {
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button + 4,
    backgroundColor: colors.primary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  grow: { flex: 1 },
});
