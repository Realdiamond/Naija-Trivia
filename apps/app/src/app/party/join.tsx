/** Join a party with the room code the host reads out (UX §2.3). */
import { useState } from 'react';
import { router } from 'expo-router';
import { normaliseRoomCode } from '@whosabi/game-rules';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';

export default function JoinParty() {
  const t = useT();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const find = () => {
    const code = normaliseRoomCode(input);
    if (!code) return setError(t('party.codeInvalid'));
    router.push(`/r/${code}`);
  };

  return (
    <Screen
      back
      backTo="/party"
      footer={
        <Button
          label={t('party.find')}
          onPress={find}
          disabled={input.trim().length < 5}
          testID="party-find"
        />
      }
    >
      <Text variant="display" accessibilityRole="header">
        {t('party.joinTitle')}
      </Text>
      <Field
        label={t('party.codeLabel')}
        hint={t('party.codeHint')}
        error={error}
        value={input}
        onChangeText={(v) => {
          setInput(v.toUpperCase());
          setError(null);
        }}
        onSubmitEditing={find}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={7}
        placeholder="K7QXM"
        testID="party-code-input"
      />
    </Screen>
  );
}
