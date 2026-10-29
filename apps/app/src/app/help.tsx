/**
 * Help (doc 16 §3, build plan step 2.7p): answers to what players ask most, in English or Pidgin,
 * and a form to write to support that sends the app's version and the device with the message.
 * The player's messages are listed with support's answers.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, SupportTopic, type MySupportTicket, type MySupportTickets } from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { useSession } from '../auth/session';
import { useT, type MessageKey } from '../i18n';
import { deviceLabel } from '../platform/deviceLabel';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

const FAQ = ['duels', 'streak', 'coins', 'practice', 'wrong', 'delete'] as const;
const TOPICS = SupportTopic.options;
const ticketsKey = ['support', 'tickets'] as const;

export default function Help() {
  const t = useT();
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  const queryClient = useQueryClient();
  const tickets = useQuery({
    queryKey: ticketsKey,
    queryFn: () => api.get<MySupportTickets>(routes.supportTickets()),
    enabled: signedIn,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [topic, setTopic] = useState<SupportTopic | null>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const send = async () => {
    if (!topic) return;
    setSending(true);
    setError(null);
    try {
      await api.post(routes.supportTickets(), {
        topic,
        message: message.trim(),
        email: email.trim() || null,
        device: deviceLabel(),
      });
      setSent(true);
      setMessage('');
      setTopic(null);
      await queryClient.invalidateQueries({ queryKey: ticketsKey });
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen back backTo="/settings">
      <Text variant="title" accessibilityRole="header">
        {t('help.title')}
      </Text>

      <Text variant="heading" style={styles.section}>
        {t('help.faq')}
      </Text>
      {FAQ.map((key) => {
        const expanded = open === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setOpen(expanded ? null : key)}
            style={styles.faq}
            testID={`faq-${key}`}
          >
            <View style={styles.faqRow}>
              <Text variant="label" style={styles.grow}>
                {t(`help.q.${key}` as MessageKey)}
              </Text>
              <Icon name="chevron-right" size={18} color={colors.inkSoft} />
            </View>
            {expanded ? <Text variant="bodySoft">{t(`help.a.${key}` as MessageKey)}</Text> : null}
          </Pressable>
        );
      })}

      <Text variant="heading" style={styles.section}>
        {t('help.write')}
      </Text>
      <Text variant="bodySoft">{t('help.writeHint')}</Text>
      <Text variant="label" style={styles.label}>
        {t('help.topic')}
      </Text>
      <View style={styles.chips}>
        {TOPICS.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected: topic === key }}
            onPress={() => {
              setTopic(key);
              setSent(false);
            }}
            style={[styles.chip, topic === key && styles.chipOn]}
            testID={`topic-${key}`}
          >
            <Text variant="label" color={topic === key ? colors.white : colors.ink}>
              {t(`help.topic.${key}` as MessageKey)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.form}>
        <Field
          label={t('help.message')}
          hint={t('help.messageHint')}
          value={message}
          onChangeText={(v) => {
            setMessage(v);
            setSent(false);
          }}
          multiline
          numberOfLines={4}
          maxLength={2000}
          testID="help-message"
        />
        <Field
          label={t('help.email')}
          hint={t('help.emailHint')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          testID="help-email"
        />
        <Button
          label={t('help.send')}
          onPress={() => void send()}
          loading={sending}
          disabled={!topic || message.trim().length < 10}
          testID="help-send"
        />
        {error ? (
          <Text variant="body" color={colors.wrongInk} testID="help-error">
            {error}
          </Text>
        ) : null}
        {sent ? (
          <Text variant="body" color={colors.correctInk} accessibilityLiveRegion="polite" testID="help-sent">
            {t('help.sent')}
          </Text>
        ) : null}
      </View>

      {tickets.isLoading ? <ActivityIndicator color={colors.primary} style={styles.section} /> : null}
      {tickets.data && tickets.data.tickets.length > 0 ? (
        <>
          <Text variant="heading" style={styles.section}>
            {t('help.yours')}
          </Text>
          {tickets.data.tickets.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function TicketRow({ ticket }: { ticket: MySupportTicket }) {
  const t = useT();
  const answered = ticket.status === 'answered';
  return (
    <View style={styles.ticket} testID={`my-ticket-${ticket.id}`}>
      <Text variant="caption" color={answered ? colors.correctInk : colors.inkSoft}>
        {t(`help.topic.${ticket.topic}` as MessageKey)} · {answered ? t('help.answered') : t('help.open')}
      </Text>
      <Text variant="body" numberOfLines={3}>
        {ticket.message}
      </Text>
      {answered ? (
        <View style={styles.answer}>
          <Text variant="body" testID="my-ticket-answer">
            {ticket.answer ?? t('help.answeredByEmail')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24, marginBottom: 8 },
  label: { marginTop: 12, marginBottom: 6 },
  grow: { flex: 1 },
  faq: {
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  faqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  form: { gap: 14, marginTop: 14 },
  ticket: {
    gap: 4,
    padding: 14,
    marginBottom: 10,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  answer: { marginTop: 6, padding: 10, borderRadius: radius.card, backgroundColor: colors.primaryTint },
});
