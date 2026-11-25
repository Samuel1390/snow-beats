import { es } from './locales/es';
import { en } from './locales/en';
import {
    LanguageCode,
    LanguageMeta,
    TranslationDictionary,
    TranslationKey,
    TranslationParams,
} from './types';

export const DEFAULT_LANGUAGE: LanguageCode = 'es';

// Registro central escalable de idiomas disponibles en la UI
export const SUPPORTED_LANGUAGES: readonly LanguageMeta[] = [
    {
        code: 'es',
        nativeName: 'Español',
        englishName: 'Spanish',
        localeTag: 'es-ES',
    },
    {
        code: 'en',
        nativeName: 'English',
        englishName: 'English',
        localeTag: 'en-US',
    },
] as const;

export const LOCALES: Record<LanguageCode, TranslationDictionary> = {
    es,
    en,
};

export function isSupportedLanguage(code: string | null | undefined): code is LanguageCode {
    if (!code) return false;
    return Object.prototype.hasOwnProperty.call(LOCALES, code);
}

export function getLanguageMeta(code: LanguageCode): LanguageMeta {
    return SUPPORTED_LANGUAGES.find((item) => item.code === code) ?? SUPPORTED_LANGUAGES[0];
}

// Traduce una clave con interpolación segura {{param}} y respaldo automático al idioma por defecto
export function translate(
    language: LanguageCode,
    key: TranslationKey,
    params?: TranslationParams
): string {
    const dict = LOCALES[language] ?? LOCALES[DEFAULT_LANGUAGE];
    let text = dict[key] ?? LOCALES[DEFAULT_LANGUAGE][key] ?? key;

    if (params) {
        for (const [paramKey, paramValue] of Object.entries(params)) {
            text = text.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(paramValue));
        }
    }
    return text;
}
