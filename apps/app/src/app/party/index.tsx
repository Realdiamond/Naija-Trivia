/**
 * A new party room (mockup 17): packs, how many questions, how long each, family-safe, the
 * Wahala Round, and whether the host plays or their screen is the big screen (UX §2.3).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { PARTY_QUESTION_COUNTS, PARTY_TIMERS_S } from '@whosabi/game-rules';
import { routes, type CategoriesResponse, type PartySettings } from '@whosabi/shared-types';
import { api, errorMessage } from '../../api';
import { useSession } from '../../auth/session';
import { party, saveSeat } from '../../features/party/api';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { CategoryDot } from '../../ui/game';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { category, colors, radius } from '../../ui/theme';

export default function NewParty() {
  const t = useT();
  const { status, user } = useSession();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoriesResponse>(routes.categories(), { auth: 'none' }),
  });
  const [picked, setPicked] = useState<string[] | null>(null);
  const [questions, setQuestions] = useState<PartySettings['questions']>(10);
  const [timer, setTimer] = useState<PartySettings['timer_s']>(15);
  const [familySafe, setFamilySafe] = useState(true);
  const [wahala, setWahala] = useState(true);
  const [hostPlays, setHostPlays] = useState(true);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const all = categories.data?.categories.map((c) => c.id) ?? [];
  // Every pack to begin with.
  const chosen = picked ?? all;
  const toggle = (id: string) =>
    setPicked(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);
  const needsNickname = !user?.username;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { room, seat } = await party.create({
        settings: {
          questions,
          timer_s: timer,
          categories: chosen,
          family_safe: familySafe,
          wahala,
          host_plays: hostPlays,
        },
        ...(needsNickname ? { nickname: nickname.trim() } : {}),
      });
      saveSeat(seat);
      router.replace(`/party/${room.code}`);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  return (
    <Screen
      back
      backTo="/home"
      footer={
        <>
          {error ? (
            <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label={t('party.create')}
            loading={busy}
            disabled={chosen.length === 0 || (needsNickname && nickname.trim().length < 2)}
            onPress={() => void create()}
            testID="party-create"
          />
        </>
      }
    >
      <Text variant="display" accessibilityRole="header">
        {t('party.newTitle')}
      </Text>
      <Button
        label={t('party.haveCode')}
        variant="link"
        size="medium"
        onPress={() => router.push('/party/join')}
        style={styles.joinLink}
        testID="party-have-code"
      />

      {needsNickname ? (
        <Field
          label={t('party.nickname')}
          hint={t('party.nicknameHint')}
          placeholder={t('party.nicknamePlaceholder')}
          value={nickname}
          onChangeText={setNickname}
          maxLength={20}
          autoCapitalize="words"
          testID="party-nickname"
        />
      ) : null}

      <Text variant="heading" style={styles.section}>
        {t('party.packs')}
      </Text>
      <View style={styles.chips}>
        {categories.data?.categories.map((c) => {
          const on = chosen.includes(c.id);
          return (
            <Pressable
              key={c.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(c.id)}
              style={[styles.chip, on && styles.chipOn]}
              testID={`party-pack-${c.id}`}
            >
              <CategoryDot id={c.id} />
              <Text variant="label">{category(c.id).name}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text variant="heading" style={styles.section}>
        {t('party.questions')}
      </Text>
      <Segments
        values={PARTY_QUESTION_COUNTS}
        value={questions}
        label={(n) => String(n)}
        onChange={setQuestions}
        testID="party-questions"
      />

      <Text variant="heading" style={styles.section}>
        {t('party.timer')}
      </Text>
      <Segments
        values={PARTY_TIMERS_S}
        value={timer}
        label={(n) => t('party.seconds', { n })}
        onChange={setTimer}
        testID="party-timer"
      />

      <View style={styles.switches}>
        <SwitchRow
          label={t('party.familySafe')}
          hint={t('party.familySafeHint')}
          value={familySafe}
          onChange={setFamilySafe}
        />
        <SwitchRow
          label={t('party.wahala')}
          hint={t('party.wahalaHint')}
          value={wahala}
          onChange={setWahala}
        />
        <SwitchRow
          label={t('party.hostPlays')}
          hint={t('party.hostPlaysHint')}
          value={hostPlays}
          onChange={setHostPlays}
          last
        />
      </View>
      <View style={styles.capacity}>
        <Icon name="users" size={20} color={colors.inkSoft} />
        <Text variant="bodySoft">{t('party.capacity')}</Text>
      </View>
    </Screen>
  );
}

function Segments<T extends number>({
  values,
  value,
  label,
  onChange,
  testID,
}: {
  values: readonly T[];
  value: T;
  label: (v: T) => string;
  onChange: (v: T) => void;
  testID: string;
}) {
  return (
    <View style={styles.segments} accessibilityRole="radiogroup">
      {values.map((v) => (
        <Pressable
          key={v}
          accessibilityRole="radio"
          accessibilityState={{ checked: v === value }}
          onPress={() => onChange(v)}
          style={[styles.segment, v === value && styles.segmentOn]}
          testID={`${testID}-${v}`}
        >
          <Text variant="label" color={v === value ? colors.ink : colors.inkSoft}>
            {label(v)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
  last = false,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.switchRow, !last && styles.switchBorder]}>
      <View style={styles.grow}>
        <Text variant="label">{label}</Text>
        <Text variant="caption">{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.borderStrong }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  joinLink: { alignSelf: 'flex-start', marginLeft: -12 },
  section: { marginTop: 20, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  segments: { flexDirection: 'row', padding: 4, borderRadius: radius.card, backgroundColor: colors.sand },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  segmentOn: { backgroundColor: colors.surface },
  switches: {
    marginTop: 20,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  switchBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  grow: { flex: 1 },
  capacity: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8 },
});
