export {
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    LOCALES,
    isSupportedLanguage,
    getLanguageMeta,
    translate,
} from './registry';
export { LanguageProvider, useI18n } from './LanguageContext';
export type {
    LanguageCode,
    LanguageMeta,
    TranslationDictionary,
    TranslationKey,
    TranslationParams,
} from './types';
