import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, ThemedBackground, useTheme } from './src/theme/ThemeContext';
import { LanguageProvider } from './src/i18n/LanguageContext';
import { SongsScreen } from './src/ui/screens/SongsScreen';
import { PlayerProvider } from './src/audio-engine/PlayerContext';
import { AlarmRingingModal } from './src/ui/components/AlarmRingingModal';

// Adapta el color de los íconos de la barra de estado según el contraste del tema activo
const AdaptiveStatusBar: React.FC = () => {
  const { isLightText } = useTheme();
  return <StatusBar style={isLightText ? 'light' : 'dark'} />;
};

export default function App() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <ThemeProvider>
          <PlayerProvider>
            <AdaptiveStatusBar />
            <ThemedBackground>
              <SongsScreen />
            </ThemedBackground>
            <AlarmRingingModal />
          </PlayerProvider>
        </ThemeProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}