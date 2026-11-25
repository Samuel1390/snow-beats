import { ImageSourcePropType } from 'react-native';

export interface ThemeImagePreset {
    id: string;
    name: string;
    dark: ImageSourcePropType;
    light: ImageSourcePropType;
    // Indica si la variante clara de la imagen es luminosa (para elegir texto oscuro o claro)
    lightVariantIsBright: boolean;
}

export interface PreviewTrackItem {
    id: string;
    title: string;
    artist: string;
    cover: ImageSourcePropType;
}

// 6 fondos predeterminados con su versión oscura (dark/) y clara (light/)
export const THEME_IMAGE_PRESETS: ThemeImagePreset[] = [
    {
        id: 'metaverse',
        name: 'Metaverse',
        dark: require('../../assets/themes/dark/metaverse.jpg'),
        light: require('../../assets/themes/light/metaverse.jpg'),
        lightVariantIsBright: false,
    },
    {
        id: 'cosmic',
        name: 'Cosmic',
        dark: require('../../assets/themes/dark/cosmic.jpg'),
        light: require('../../assets/themes/light/cosmic.jpg'),
        lightVariantIsBright: false,
    },
    {
        id: 'mechanic_city',
        name: 'Mechanic City',
        dark: require('../../assets/themes/dark/mechanic_city.jpg'),
        light: require('../../assets/themes/light/mechanic_city.jpg'),
        lightVariantIsBright: true,
    },
    {
        id: 'satellite',
        name: 'Satellite',
        dark: require('../../assets/themes/dark/satellite.jpg'),
        light: require('../../assets/themes/light/satellite.jpg'),
        lightVariantIsBright: false,
    },
    {
        id: 'katana',
        name: 'Katana',
        dark: require('../../assets/themes/dark/katana.jpg'),
        light: require('../../assets/themes/light/katana.jpg'),
        lightVariantIsBright: true,
    },
    {
        id: 'robotic_arm',
        name: 'Robotic Arm',
        dark: require('../../assets/themes/dark/robotic_arm.jpg'),
        light: require('../../assets/themes/light/robotic_arm.jpg'),
        lightVariantIsBright: false,
    },
];

// Canciones y carátulas reales proporcionadas para la vista previa en vivo del tema
export const PREVIEW_TRACKS: PreviewTrackItem[] = [
    {
        id: 'preview-1',
        title: 'At The Top',
        artist: 'NEFFEX',
        cover: require('../../assets/preview-covers/cover_4.jpg'),
    },
    {
        id: 'preview-2',
        title: 'Marionette',
        artist: 'John Michael Howell',
        cover: require('../../assets/preview-covers/cover_3.jpg'),
    },
    {
        id: 'preview-3',
        title: 'Winter Piano',
        artist: 'Snow Sessions',
        cover: require('../../assets/preview-covers/cover_1.jpg'),
    },
    {
        id: 'preview-4',
        title: 'Late Night Keys',
        artist: 'Acoustic Live',
        cover: require('../../assets/preview-covers/cover_2.jpg'),
    },
    {
        id: 'preview-5',
        title: 'Starlight Spire',
        artist: 'Nocturne',
        cover: require('../../assets/preview-covers/cover_5.jpg'),
    },
];

// Obtiene los metadatos de un fondo predeterminado por su identificador
export function getThemePresetById(presetId: string): ThemeImagePreset | null {
    return THEME_IMAGE_PRESETS.find((p) => p.id === presetId) ?? null;
}

// Resuelve el recurso empaquetado de un fondo predeterminado según si el tema efectivo es oscuro o claro
export function getPresetImageSource(
    presetId: string,
    isDarkMode: boolean
): ImageSourcePropType | null {
    const found = getThemePresetById(presetId);
    if (!found) return null;
    return isDarkMode ? found.dark : found.light;
}
