import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeTime } from '@/lib/format';
import { FootballCategory } from '@/lib/feeds';

const CATEGORY_LABEL: Record<FootballCategory, string> = {
  nfl: 'NFL',
  college: 'College',
  highschool: 'High School',
};

export default function ArticleScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    title: string;
    link: string;
    source: string;
    category: FootballCategory;
    publishedAt: string;
    description: string;
    imageUrl: string;
  }>();

  const openInBrowser = () => WebBrowser.openBrowserAsync(params.link);

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: '', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          {params.imageUrl ? (
            <Image source={{ uri: params.imageUrl }} style={styles.image} contentFit="cover" />
          ) : null}

          <View style={styles.body}>
            <ThemedText type="small" themeColor="textSecondary">
              {CATEGORY_LABEL[params.category]} · {params.source}
              {params.publishedAt ? ` · ${formatRelativeTime(params.publishedAt)}` : ''}
            </ThemedText>

            <ThemedText type="subtitle" style={styles.title}>
              {params.title}
            </ThemedText>

            {params.description ? (
              <ThemedText style={styles.description}>{params.description}</ThemedText>
            ) : null}

            <TouchableOpacity
              style={[styles.readButton, { backgroundColor: theme.text }]}
              onPress={openInBrowser}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                Read Full Article
              </ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing.five,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
  },
  description: {
    marginTop: Spacing.one,
  },
  readButton: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
  },
});
