/**
 * What the Who Sabi team told the player (build plan step 2.7d): a moderator's warning on Home,
 * and why they are picking a new username. Each shows until the player says they have seen it.
 */
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { routes, type PlayerNotice } from '@whosabi/shared-types';
import { api } from '../../api';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

/** Marks a notice seen and looks at /me again. Never in the player's way. */
export function useNoticeSeen() {
  const queryClient = useQueryClient();
  return (id: number) =>
    void api
      .post(routes.noticeSeen(id))
      .catch(() => undefined)
      .then(() => queryClient.invalidateQueries({ queryKey: ['me'] }));
}

export function WarningCard({ notice }: { notice: PlayerNotice }) {
  const t = useT();
  const seen = useNoticeSeen();
  return (
    <View style={styles.card} accessibilityRole="alert" testID="warning-notice">
      <View style={styles.title}>
        <Icon name="shield" size={20} color={colors.accentInk} />
        <Text variant="heading">{t('notice.warningTitle')}</Text>
      </View>
      <Text variant="body">{notice.message}</Text>
      <Text variant="caption">{t('notice.appeal')}</Text>
      <Button
        label={t('notice.ok')}
        variant="outline"
        size="medium"
        onPress={() => seen(notice.id)}
        testID="warning-ok"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.accentTint,
    marginBottom: 12,
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
