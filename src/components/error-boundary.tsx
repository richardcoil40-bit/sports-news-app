import { Component, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level safety net. Without this, any uncaught render-time error
 * anywhere in the tree (a data shape ESPN or an RSS feed sends that nothing
 * anticipated, for example) crashes the whole app to a blank screen with no
 * way back short of force-quitting. This catches it and offers a retry
 * instead.
 *
 * Error boundaries have to be class components — there's no hooks
 * equivalent — and deliberately avoid the app's theme/hook helpers so this
 * fallback can't itself fail for the same reason something upstream did.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] caught', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          {this.state.error.message || 'An unexpected error occurred.'}
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.reset}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 32,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
  },
  message: {
    fontSize: 13,
    color: '#60646C',
    textAlign: 'center',
  },
  button: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#000000',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
