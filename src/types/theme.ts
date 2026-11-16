// Tipos de tema, paletas planas, gradientes y fondo personalizado con imagen
export type ThemeMode = 'dark' | 'light' | 'system';

export type BackgroundStyleType = 'solid' | 'gradient' | 'image';

export interface CustomImageBackground {
    uri: string;
    blur: number;       // Por defecto 0 (rango sugerido: 0 a 25)
    brightness: number; // Por defecto 100 (rango: 0 a 100; solo se reduce para oscurecer)
}

export interface ThemeConfig {
    mode: ThemeMode;
    backgroundType: BackgroundStyleType;
    solidColor: string;
    gradientColors: [string, string]; // [color arriba, color abajo]
    customImage: CustomImageBackground | null;
    // Si backgroundType === 'image', la UI siempre fuerza foreground a '#FFFFFF'
    foregroundColor: string;
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
    mode: 'dark',
    backgroundType: 'solid',
    solidColor: '#0A0A0A',
    gradientColors: ['#111827', '#000000'],
    customImage: null,
    foregroundColor: '#FFFFFF',
};