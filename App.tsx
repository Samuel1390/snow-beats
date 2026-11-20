import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, ThemedBackground } from './src/theme/ThemeContext';
import { SongsScreen } from './src/ui/screens/SongsScreen';
import { PlayerProvider } from './src/audio-engine/PlayerContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PlayerProvider>
          <StatusBar style="light" />
          <ThemedBackground>
            <SongsScreen />
          </ThemedBackground>
        </PlayerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}