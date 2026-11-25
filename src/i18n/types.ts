import type { es } from './locales/es';

// Códigos de idioma soportados (para agregar un nuevo idioma: añadir código aquí, crear locales/<code>.ts y registrarlo en src/i18n/index.ts)
export type LanguageCode = 'es' | 'en';

export interface LanguageMeta {
    code: LanguageCode;
    nativeName: string;
    englishName: string;
    localeTag: string;
}

export type TranslationKey = keyof typeof es;

export type TranslationDictionary = Record<TranslationKey, string>;

export type TranslationParams = Record<string, string | number>;
