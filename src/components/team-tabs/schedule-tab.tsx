import { ActivityIndicator, FlatList } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ScheduleRow } from '@/components/schedule-row';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { ScheduledGame } from '@/lib/schedule';

export function ScheduleTab({
  games,
  loading,
  error,
  accentColor,
}: {
  games: ScheduledGame[] | null;
  loading: boolean;
  error: boolean;
  accentColor: string | null;
}) {
  if (loading && !games) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  return (
    <FlatList
      data={games ?? []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <AccentRow color={accentColor}>
          <ScheduleRow game={item} />
        </AccentRow>
      )}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={
        <Centered>
          <ThemedText themeColor="textSecondary" style={tabStyles.centeredText}>
            {error ? "Couldn't load the schedule right now. Try again later." : 'No schedule found.'}
          </ThemedText>
        </Centered>
      }
      contentContainerStyle={tabStyles.listContent}
    />
  );
}
