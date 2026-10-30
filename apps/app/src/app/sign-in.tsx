/**
 * Sign in or sign up (mockups 04 and 05). A guest who signs in keeps their progress
 * (FR-AUTH-4). A code goes by text or by email (step 2.10), whichever are switched on; with both
 * on, the player can switch (`?with=email` opens on email).
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ErrorCode, normalizeNigerianPhone } from '@whosabi/shared-types';
import { api, ApiError, errorMessage } from '../api';
import { captchaAvailable, captchaToken } from '../auth/captcha';
import { googleAvailable } from '../auth/GoogleButton';
import { afterSignIn, SignInOptions, useAuthMethods } from '../features/auth/SignInOptions';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors } from '../ui/theme';

type Channel = 'phone' | 'email';
type Step =
  { kind: 'enter' } | { kind: 'code'; channel: Channel; requestId: string; to: string; resendAt: number };

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function SignIn() {
  const t = useT();
  const { reason, with: wanted } = useLocalSearchParams<{ reason?: string; with?: string }>();
  const methods = useAuthMethods();
  const [step, setStep] = useState<Step>({ kind: 'enter' });
  const [picked, setPicked] = useState<Channel | null>(
    wanted === 'email' || wanted === 'phone' ? wanted : null,
  );
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the player leaves the field or taps "Send code": from then on, what's wrong shows
  // under it until it's right (not while they are still typing it the first time).
  const [checking, setChecking] = useState<Channel | null>(null);
  const now = useNow(step.kind === 'code');

  const phoneOn = methods.data?.phone === true;
  const emailOn = methods.data?.email === true;
  // The one asked for when it is on, else phone, else email.
  const channel: Channel | null =
    picked === 'email' && emailOn ? 'email' : phoneOn ? 'phone' : emailOn ? 'email' : null;

  const phoneProblem =
    checking === 'phone' && phone.trim() !== '' && !normalizeNigerianPhone(phone)
      ? t('signin.phoneInvalid')
      : null;
  const emailProblem =
    checking === 'email' && email.trim() !== '' && !looksLikeEmail(email) ? t('signin.emailInvalid') : null;

  const sendCode = async (via: Channel) => {
    const ok = via === 'phone' ? normalizeNigerianPhone(phone) !== null : looksLikeEmail(email);
    if (!ok) {
      setChecking(via);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const to = via === 'phone' ? phone : email.trim();
      const token = await captchaToken();
      const sent = via === 'phone' ? await api.sendPhoneCode(to, token) : await api.sendEmailCode(to, token);
      setStep({
        kind: 'code',
        channel: via,
        requestId: sent.request_id,
        to,
        resendAt: Date.now() + sent.resend_after_s * 1000,
      });
      setCode('');
    } catch (e) {
      // Phones can't show the human check the API asks for after two codes in a day.
      const needsCheck = e instanceof ApiError && e.code === ErrorCode.captchaRequired && !captchaAvailable;
      setError(needsCheck ? t('signin.captchaNative') : errorMessage(e, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (step.kind !== 'code' || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const signedIn =
        step.channel === 'phone'
          ? await api.verifyPhoneCode(step.requestId, value)
          : await api.verifyEmailCode(step.requestId, value);
      afterSignIn(signedIn.user);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  if (step.kind === 'code') {
    const wait = Math.max(0, Math.ceil((step.resendAt - now) / 1000));
    return (
      <Screen back>
        <View style={styles.form}>
          <Text variant="display" accessibilityRole="header">
            {t('signin.codeTitle')}
          </Text>
          <Text variant="bodySoft">
            {step.channel === 'phone'
              ? t('signin.codeSent', { phone: step.to })
              : t('signin.codeSentEmail', { email: step.to })}
          </Text>
          <Field
            label={t('signin.code')}
            value={code}
            onChangeText={(text) => {
              const digits = text.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              if (digits.length === 6) void verify(digits);
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            error={error}
            testID="code"
          />
          <Button
            label={t('signin.verify')}
            loading={busy}
            disabled={code.length !== 6}
            onPress={() => void verify(code)}
          />
          <Button
            label={wait > 0 ? t('signin.resendIn', { seconds: wait }) : t('signin.resend')}
            variant="link"
            disabled={wait > 0 || busy}
            onPress={() => void sendCode(step.channel)}
          />
          <Button
            label={step.channel === 'phone' ? t('signin.changeNumber') : t('signin.changeEmail')}
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
      back
      footer={
        <Text variant="caption" align="center">
          {t('signin.terms')}
        </Text>
      }
    >
      <View style={styles.form}>
        <Text variant="display" accessibilityRole="header">
          {t('signin.title')}
        </Text>
        <Text variant="bodySoft">{t('signin.subtitle')}</Text>
        {reason === 'device' ? (
          <Text variant="body" color={colors.accentInk}>
            {t('signin.deviceTaken')}
          </Text>
        ) : null}

        {channel === 'phone' ? (
          <>
            <Field
              label={t('signin.phone')}
              prefix="+234"
              value={phone}
              onChangeText={setPhone}
              placeholder="0803 123 4567"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              hint={t('signin.phoneHint')}
              error={phoneProblem ?? error}
              onBlur={() => setChecking('phone')}
              testID="phone"
            />
            <Button
              label={t('signin.sendCode')}
              loading={busy}
              disabled={phone.trim() === ''}
              onPress={() => void sendCode('phone')}
              testID="send-code"
            />
          </>
        ) : null}
        {channel === 'email' ? (
          <>
            <Field
              label={t('signin.email')}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              hint={t('signin.emailHint')}
              error={emailProblem ?? error}
              onBlur={() => setChecking('email')}
              testID="email"
            />
            <Button
              label={t('signin.sendCode')}
              loading={busy}
              disabled={email.trim() === ''}
              onPress={() => void sendCode('email')}
              testID="send-code"
            />
          </>
        ) : null}
        {phoneOn && emailOn ? (
          <Button
            label={channel === 'phone' ? t('signin.useEmail') : t('signin.usePhone')}
            variant="link"
            onPress={() => {
              setError(null);
              setPicked(channel === 'phone' ? 'email' : 'phone');
            }}
            testID="switch-channel"
          />
        ) : null}
        {channel && methods.data?.google && googleAvailable ? (
          <View style={styles.divider}>
            <View style={styles.line} />
            <Text variant="caption">{t('signin.or')}</Text>
            <View style={styles.line} />
          </View>
        ) : null}

        {/* With a code form above, its "Send code" is the main button; Google is the other way in. */}
        <SignInOptions showCodes={false} lead={!channel} />
        {!channel ? (
          <Button label={t('taste.result.later')} variant="link" onPress={() => router.replace('/')} />
        ) : null}
      </View>
    </Screen>
  );
}

/** The clock, ticking once a second while `on`, for the resend countdown. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

const styles = StyleSheet.create({
  form: { gap: 18 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
});
