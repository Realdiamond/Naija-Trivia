/**
 * Sign in or sign up (mockups 04 and 05). A guest who signs in keeps their progress
 * (FR-AUTH-4). The phone part only shows when phone codes are switched on.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ErrorCode } from '@whosabi/shared-types';
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

type Step = { kind: 'phone' } | { kind: 'code'; requestId: string; phone: string; resendAt: number };

export default function SignIn() {
  const t = useT();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const methods = useAuthMethods();
  const [step, setStep] = useState<Step>({ kind: 'phone' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(step.kind === 'code');

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = await api.sendPhoneCode(phone, await captchaToken());
      setStep({
        kind: 'code',
        requestId: sent.request_id,
        phone,
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
      afterSignIn((await api.verifyPhoneCode(step.requestId, value)).user);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  const phoneOn = methods.data?.phone === true;

  if (step.kind === 'code') {
    const wait = Math.max(0, Math.ceil((step.resendAt - now) / 1000));
    return (
      <Screen back>
        <View style={styles.form}>
          <Text variant="display" accessibilityRole="header">
            {t('signin.codeTitle')}
          </Text>
          <Text variant="bodySoft">{t('signin.codeSent', { phone: step.phone })}</Text>
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
            onPress={() => void sendCode()}
          />
          <Button
            label={t('signin.changeNumber')}
            variant="link"
            onPress={() => setStep({ kind: 'phone' })}
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

        {phoneOn ? (
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
              error={error}
              testID="phone"
            />
            <Button
              label={t('signin.sendCode')}
              loading={busy}
              disabled={phone.replace(/\D/g, '').length < 10}
              onPress={() => void sendCode()}
              testID="send-code"
            />
            {methods.data?.google && googleAvailable ? (
              <View style={styles.divider}>
                <View style={styles.line} />
                <Text variant="caption">{t('signin.or')}</Text>
                <View style={styles.line} />
              </View>
            ) : null}
          </>
        ) : null}

        <SignInOptions showPhone={false} />
        {!phoneOn ? (
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
