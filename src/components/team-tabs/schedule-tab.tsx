import { ActivityIndicator, FlatList } from 'react-native';

import { AccentRow } from '@/components/accent-row';
import { ScheduleRow } from '@/components/schedule-row';
import { Centered, Separator, tabStyles } from '@/components/team-tabs/shared';
import { ThemedText } from '@/components/themed-text';
import { isRecentOrUpcoming } from '@/lib/game';
import { ScheduledGame } from '@/lib/schedule';

export function ScheduleTab({
  games,
  loading,
  error,
  accentColor,
  checkedAt,
  onOpenGame,
}: {
  games: ScheduledGame[] | null;
  /** When `games` was fetched — which game is today's is judged against it. */
  checkedAt: number;
  loading: boolean;
  error: boolean;
  accentColor: string | null;
  onOpenGame?: (game: ScheduledGame) => void;
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
          <ScheduleRow
            game={item}
            // A finished game opens its recap however old it is; an upcoming
            // one only once it is close enough for its screen to show something.
            onPress={
              onOpenGame && (item.completed || isRecentOrUpcoming(item.date, checkedAt))
                ? () => onOpenGame(item)
                : undefined
            }
          />
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
