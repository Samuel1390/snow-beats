// Tipos de tema, paletas planas, gradientes y fondo personalizado o predeterminado con imagen
export type ThemeMode = 'dark' | 'light' | 'system';

export type BackgroundStyleType = 'solid' | 'gradient' | 'image';

export interface CustomImageBackground {
    uri?: string;       // URI local de galería (imagen personalizada del usuario)
    presetId?: string;  // ID de imagen predeterminada (resuelve dark/ o light/ según modo)
    blur: number;       // Por defecto 0 (rango sugerido: 0 a 25)
    brightness: number; // Por defecto 100 (rango: 0 a 100; solo se reduce para oscurecer)
}

export interface ThemeConfig {
    mode: ThemeMode;
    backgroundType: BackgroundStyleType;
    solidColor: string;
    gradientColors: [string, string]; // [color arriba, color abajo]
    customImage: CustomImageBackground | null;
    // Historial persistente de personalizaciones creadas por el usuario
    customSolidColors?: string[];
    customGradients?: [string, string][];
    customImages?: CustomImageBackground[];
    // Si backgroundType === 'image', la UI adapta el contraste según modo oscuro/claro
    foregroundColor: string;
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
    mode: 'dark',
    backgroundType: 'solid',
    solidColor: '#0A0A0A',
    gradientColors: ['#111827', '#000000'],
    customImage: null,
    customSolidColors: [],
    customGradients: [],
    customImages: [],
    foregroundColor: '#FFFFFF',
};