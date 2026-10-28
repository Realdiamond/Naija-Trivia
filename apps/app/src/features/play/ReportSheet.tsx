/**
 * "Report this question" (mockup 27, PRD US-9): a reason in one tap, an optional note, sent.
 * Editors see it in the admin console; enough reports take the question out of the game at once.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { routes, type ReportReason } from '@whosabi/shared-types';
import { api, errorMessage } from '../../api';
import { useT, type MessageKey } from '../../i18n';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

const REASONS: Array<{ id: ReportReason; label: MessageKey }> = [
  { id: 'wrong_answer', label: 'report.wrongAnswer' },
  { id: 'outdated', label: 'report.outdated' },
  { id: 'offensive', label: 'report.offensive' },
  { id: 'typo', label: 'report.typo' },
  { id: 'unfair', label: 'report.unfair' },
];

interface Props {
  visible: boolean;
  qid: string;
  text: string;
  onClose: () => void;
}

export function ReportSheet({ visible, qid, text, onClose }: Props) {
  const t = useT();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason(null);
    setNote('');
    setSent(false);
    setError(null);
    onClose();
  };

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(routes.questionReports(qid), { reason, ...(note.trim() ? { note: note.trim() } : {}) });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('report.cancel')} />
        <View style={styles.sheet} testID="report-sheet">
          <View style={styles.handle} />
          <Text variant="title">{t('report.title')}</Text>
          <Text variant="bodySoft" numberOfLines={3}>
            {text}
          </Text>
          {sent ? (
            <>
              <Text variant="body" color={colors.correctInk} testID="report-thanks">
                {t('report.thanks')}
              </Text>
              <Button label={t('report.done')} onPress={close} />
            </>
          ) : (
            <>
              <Text variant="label">{t('report.what')}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {REASONS.map((r) => {
                  const on = reason === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      accessibilityRole="radio"
                      aria-checked={on}
                      onPress={() => setReason(r.id)}
                      style={[styles.chip, on && styles.chipOn]}
                      testID={`reason-${r.id}`}
                    >
                      <Text variant="label" color={on ? colors.primaryInk : colors.inkSoft}>
                        {t(r.label)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Field
                label={t('report.more')}
                value={note}
                onChangeText={setNote}
                placeholder={t('report.placeholder')}
                maxLength={300}
                multiline
              />
              {error ? (
                <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}
              <Button
                label={t('report.send')}
                onPress={() => void send()}
                disabled={!reason}
                loading={busy}
                testID="report-send"
              />
              <Button label={t('report.cancel')} variant="link" size="medium" onPress={close} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14, 26, 20, 0.5)' },
  sheet: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: 14,
    padding: 20,
    paddingBottom: 28,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.bg,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
});
