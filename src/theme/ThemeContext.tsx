import React, { createContext, useContext, useEffect, useState } from 'react';
import { ImageBackground, StyleSheet, useColorScheme, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DEFAULT_THEME_CONFIG, ThemeConfig } from '../types/theme';
import { getAppSetting, setAppSetting } from '../storage/database/db';

// 10 paletas planas predeterminadas (oscuro y claro)
export const SOLID_PALETTES = [
    { name: 'Obsidiana', darkBg: '#0A0A0A', lightBg: '#FFFFFF' },
    { name: 'Noche Azul', darkBg: '#0B1120', lightBg: '#EFF6FF' },
    { name: 'Esmeralda', darkBg: '#061A14', lightBg: '#ECFDF5' },
    { name: 'Vino', darkBg: '#1C0A12', lightBg: '#FFF1F2' },
    { name: 'Índigo', darkBg: '#120E24', lightBg: '#EEF2FF' },
    { name: 'Grafito', darkBg: '#18181B', lightBg: '#F4F4F5' },
    { name: 'Ámbar', darkBg: '#1C1408', lightBg: '#FFFBEB' },
    { name: 'Cian', darkBg: '#081A20', lightBg: '#ECFEFF' },
    { name: 'Violeta', darkBg: '#190D26', lightBg: '#F5F3FF' },
    { name: 'Bosque', darkBg: '#0C1A0E', lightBg: '#F0FDF4' },
];

// Gradientes predeterminados [arriba, abajo]
export const GRADIENT_PRESETS: { name: string; colors: [string, string] }[] = [
    { name: 'Medianoche', colors: ['#1E293B', '#020617'] },
    { name: 'Aurora', colors: ['#064E3B', '#020617'] },
    { name: 'Neón Púrpura', colors: ['#3B0764', '#09090B'] },
    { name: 'Atardecer', colors: ['#7C2D12', '#0A0A0A'] },
    { name: 'Océano', colors: ['#0C4A6E', '#020617'] },
    { name: 'Carmesí', colors: ['#7F1D1D', '#0A0A0A'] },
];

interface ThemeContextValue {
    theme: ThemeConfig;
    isLightText: boolean;
    fgColor: string;
    mutedColor: string;
    updateTheme: (partial: Partial<ThemeConfig>) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const systemScheme = useColorScheme();
    const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME_CONFIG);

    useEffect(() => {
        getAppSetting('theme_config').then((raw) => {
            if (raw) {
                try {
                    setTheme({ ...DEFAULT_THEME_CONFIG, ...JSON.parse(raw) });
                } catch { }
            }
        });
    }, []);

    const updateTheme = (partial: Partial<ThemeConfig>) => {
        setTheme((prev) => {
            const next = { ...prev, ...partial };
            setAppSetting('theme_config', JSON.stringify(next));
            return next;
        });
    };

    // Si hay imagen de galería o gradiente, el texto siempre es blanco
    const effectiveDark =
        theme.backgroundType === 'image' ||
        theme.backgroundType === 'gradient' ||
        theme.mode === 'dark' ||
        (theme.mode === 'system' && systemScheme !== 'light');

    const fgColor = effectiveDark ? '#FFFFFF' : '#111827';
    const mutedColor = effectiveDark ? 'rgba(255,255,255,0.7)' : 'rgba(17,24,39,0.7)';

    return (
        <ThemeContext.Provider
            value={{ theme, isLightText: effectiveDark, fgColor, mutedColor, updateTheme }}
        >
            {children}
        </ThemeContext.Provider>
    );
};

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
    return ctx;
}

// Contenedor que pinta el fondo sólido, gradiente o imagen con blur y brillo
export const ThemedBackground: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme } = useTheme();

    if (theme.backgroundType === 'image' && theme.customImage?.uri) {
        // Brillo 100% = 0 opacidad oscura; Brillo 0% = 100% negro
        const darkOverlayOpacity = Math.max(0, Math.min(1, 1 - theme.customImage.brightness / 100));
        return (
            <ImageBackground
                source={{ uri: theme.customImage.uri }}
                blurRadius={theme.customImage.blur}
                style={styles.fill}
                resizeMode="cover"
            >
                <View
                    style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: `rgba(0, 0, 0, ${darkOverlayOpacity})` },
                    ]}
                />
                {children}
            </ImageBackground>
        );
    }

    if (theme.backgroundType === 'gradient') {
        return (
            <LinearGradient colors={theme.gradientColors} style={styles.fill}>
                {children}
            </LinearGradient>
        );
    }

    return <View style={[styles.fill, { backgroundColor: theme.solidColor }]}>{children}</View>;
};

const styles = StyleSheet.create({
    fill: { flex: 1 },
});