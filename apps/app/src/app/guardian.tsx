/**
 * Asking a parent or guardian (doc 10 §3.3, build plan step 2.8d). A player under 18 needs
 * their consent before using an account: we send them a code by text or email, and if they
 * agree they give it to the player. Then the profile the player filled in is saved. Until then
 * the player can sign out and keep playing as a guest.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, routes, type Me, type OtpSendResponse } from '@whosabi/shared-types';
import { api, ApiError, errorMessage } from '../api';
import { captchaAvailable, captchaToken } from '../auth/captcha';
import { signOut, updateUser, useSession } from '../auth/session';
import { PLATFORM } from '../config';
import { useAuthMethods } from '../features/auth/SignInOptions';
import { useProfileDraft } from '../features/guardian/draft';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';

type Channel = 'phone' | 'email';
type Step = { kind: 'enter' } | { kind: 'code'; requestId: string; to: string };

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function Guardian() {
  const t = useT();
  const status = useSession((s) => s.status);
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>(routes.me()),
    enabled: status === 'account',
  });
  const methods = useAuthMethods();
  const [picked, setPicked] = useState<Channel | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signed_out') return <Redirect href="/welcome" />;
  if (status === 'guest') return <Redirect href="/sign-in" />;
  if (me.data && me.data.guardian !== 'needed') {
    return <Redirect href={me.data.username ? '/home' : '/profile-setup'} />;
  }

  const phoneOn = methods.data?.phone === true;
  const emailOn = methods.data?.email === true;
  const channel: Channel | null =
    picked === 'email' && emailOn ? 'email' : phoneOn ? 'phone' : emailOn ? 'email' : null;

  const send = async () => {
    if (!channel) return;
    setBusy(true);
    setError(null);
    try {
      const token = await captchaToken();
      const sent = await api.post<OtpSendResponse>(routes.meGuardianSend(), {
        [channel]: contact.trim(),
        platform: PLATFORM,
        ...(token ? { turnstile_token: token } : {}),
      });
      setStep({ kind: 'code', requestId: sent.request_id, to: contact.trim() });
      setCode('');
    } catch (e) {
      const needsCheck = e instanceof ApiError && e.code === ErrorCode.captchaRequired && !captchaAvailable;
      setError(needsCheck ? t('signin.captchaNative') : errorMessage(e, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (value: string) => {
    if (step.kind !== 'code' || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      let updated = await api.post<Me>(routes.meGuardianVerify(), {
        request_id: step.requestId,
        code: value,
      });
      queryClient.setQueryData(['me'], updated);
      // Now the profile they filled in while waiting can be saved.
      const { draft } = useProfileDraft.getState();
      if (draft) {
        try {
          updated = await api.patch<Me>(routes.me(), {
            username: draft.username,
            avatar_id: draft.avatar_id,
            ...(draft.home_state ? { home_state: draft.home_state } : {}),
          });
          queryClient.setQueryData(['me'], updated);
          useProfileDraft.setState({ draft: null });
        } catch {
          // A name taken in the meantime: the profile screen, with what they typed, says so.
        }
      }
      updateUser({ username: updated.username, status: updated.status });
      router.replace(updated.username ? '/home' : '/profile-setup');
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  const later = () => void signOut().then(() => router.replace('/welcome'));

  if (step.kind === 'code') {
    return (
      <Screen>
        <View style={styles.form}>
          <Text variant="display" accessibilityRole="header">
            {t('guardian.codeTitle')}
          </Text>
          <Text variant="bodySoft">{t('guardian.codeSent', { to: step.to })}</Text>
          <Field
            label={t('signin.code')}
            value={code}
            onChangeText={(text) => {
              const digits = text.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              if (digits.length === 6) void confirm(digits);
            }}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            error={error}
            testID="guardian-code"
          />
          <Button
            label={t('signin.verify')}
            loading={busy}
            disabled={code.length !== 6}
            onPress={() => void confirm(code)}
            testID="guardian-confirm"
          />
          <Button
            label={channel === 'phone' ? t('signin.changeNumber') : t('signin.changeEmail')}
            variant="link"
            onPress={() => {
              setError(null);
              setStep({ kind: 'enter' });
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label={t('guardian.later')}
          variant="link"
          size="medium"
          onPress={later}
          testID="guardian-later"
        />
      }
    >
      <View style={styles.form}>
        <Text variant="display" accessibilityRole="header">
          {t('guardian.title')}
        </Text>
        <Text variant="body">{t('guardian.body')}</Text>
        <Text variant="bodySoft">{t('guardian.rules')}</Text>
        {channel ? (
          <>
            <Field
              label={channel === 'phone' ? t('guardian.phone') : t('guardian.email')}
              prefix={channel === 'phone' ? '+234' : undefined}
              value={contact}
              onChangeText={setContact}
              placeholder={channel === 'phone' ? '0803 123 4567' : 'parent@example.com'}
              keyboardType={channel === 'phone' ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              error={error}
              testID="guardian-contact"
            />
            <Button
              label={t('guardian.send')}
              loading={busy}
              disabled={
                channel === 'phone' ? contact.replace(/\D/g, '').length < 10 : !looksLikeEmail(contact)
              }
              onPress={() => void send()}
              testID="guardian-send"
            />
            {phoneOn && emailOn ? (
              <Button
                label={channel === 'phone' ? t('signin.useEmail') : t('signin.usePhone')}
                variant="link"
                onPress={() => {
                  setError(null);
                  setContact('');
                  setPicked(channel === 'phone' ? 'email' : 'phone');
                }}
                testID="guardian-switch"
              />
            ) : null}
          </>
        ) : methods.data ? (
          <Text variant="body" testID="guardian-unavailable">
            {t('guardian.unavailable')}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: 18 } });
