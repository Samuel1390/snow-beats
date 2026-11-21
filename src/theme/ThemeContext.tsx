import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ImageBackground, ImageSourcePropType, StyleSheet, useColorScheme, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DEFAULT_THEME_CONFIG, ThemeConfig } from '../types/theme';
import { getAppSetting, setAppSetting } from '../storage/database/db';
import { getRelativeLuminance } from './colorContrast';
import { getPresetImageSource } from './themeAssets';

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
    { name: 'Cielo', colors: ['#1D4ED8', '#0F172A'] },
    { name: 'Esmeralda Viva', colors: ['#0F766E', '#042F2E'] },
];

// Resuelve si el modo seleccionado (dark / light / system) es oscuro
export function resolveIsDarkMode(mode: ThemeConfig['mode'], systemScheme: string | null | undefined): boolean {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return systemScheme !== 'light';
}

// Resuelve el recurso de imagen (predeterminado según modo oscuro/claro o foto de galería)
export function resolveThemeImageSource(
    theme: ThemeConfig,
    systemScheme: string | null | undefined
): ImageSourcePropType | null {
    const img = theme.customImage;
    if (!img) return null;
    if (img.presetId) {
        const darkMode = resolveIsDarkMode(theme.mode, systemScheme);
        return getPresetImageSource(img.presetId, darkMode);
    }
    if (img.uri) {
        return { uri: img.uri };
    }
    return null;
}

// Calcula automáticamente si el texto sobre un tema debe ser blanco u oscuro según WCAG
export function resolveIsLightText(theme: ThemeConfig, systemScheme: string | null | undefined): boolean {
    if (theme.backgroundType === 'image') {
        const darkMode = resolveIsDarkMode(theme.mode, systemScheme);
        // En imagen predeterminada clara con brillo alto usamos texto oscuro sobre velo claro suave
        if (theme.customImage?.presetId && !darkMode && (theme.customImage.brightness ?? 100) >= 75) {
            return false;
        }
        return true;
    }
    if (theme.backgroundType === 'gradient') {
        const avgLum =
            (getRelativeLuminance(theme.gradientColors[0]) +
                getRelativeLuminance(theme.gradientColors[1])) /
            2;
        return avgLum < 0.32;
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(theme.solidColor)) {
        return getRelativeLuminance(theme.solidColor) < 0.34;
    }
    return resolveIsDarkMode(theme.mode, systemScheme);
}

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

    const updateTheme = useCallback((partial: Partial<ThemeConfig>) => {
        setTheme((prev) => {
            const next = { ...prev, ...partial };
            setAppSetting('theme_config', JSON.stringify(next));
            return next;
        });
    }, []);

    const effectiveLightText = resolveIsLightText(theme, systemScheme);
    const fgColor = effectiveLightText ? '#FFFFFF' : '#111827';
    const mutedColor = effectiveLightText ? 'rgba(255,255,255,0.72)' : 'rgba(17,24,39,0.68)';

    const value = useMemo(
        () => ({ theme, isLightText: effectiveLightText, fgColor, mutedColor, updateTheme }),
        [theme, effectiveLightText, fgColor, mutedColor, updateTheme]
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
    return ctx;
}

// Contenedor que pinta el fondo sólido, gradiente o imagen (predeterminada o galería) con blur y brillo
export const ThemedBackground: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme } = useTheme();
    const systemScheme = useColorScheme();

    if (theme.backgroundType === 'image' && theme.customImage) {
        const source = resolveThemeImageSource(theme, systemScheme);
        if (source) {
            const darkMode = resolveIsDarkMode(theme.mode, systemScheme);
            const isLightPreset = Boolean(theme.customImage.presetId && !darkMode);
            const brightness = theme.customImage.brightness ?? 100;
            const darkOverlayOpacity = Math.max(0, Math.min(1, 1 - brightness / 100));
            const baseScrim = isLightPreset && brightness >= 75
                ? 'rgba(255, 255, 255, 0.36)'
                : `rgba(0, 0, 0, ${Math.max(0.22, darkOverlayOpacity)})`;

            return (
                <ImageBackground
                    source={source}
                    blurRadius={theme.customImage.blur}
                    style={styles.fill}
                    resizeMode="cover"
                >
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: baseScrim }]} />
                    {children}
                </ImageBackground>
            );
        }
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