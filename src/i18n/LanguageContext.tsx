import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAppSetting, setAppSetting } from '../storage/database/db';
import {
    DEFAULT_LANGUAGE,
    getLanguageMeta,
    isSupportedLanguage,
    SUPPORTED_LANGUAGES,
    translate,
} from './registry';
import { LanguageCode, LanguageMeta, TranslationKey, TranslationParams } from './types';

const STORAGE_KEY = 'app_language';

interface LanguageContextValue {
    language: LanguageCode;
    localeTag: string;
    supportedLanguages: readonly LanguageMeta[];
    setLanguage: (code: LanguageCode) => void;
    t: (key: TranslationKey, params?: TranslationParams) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

// Proveedor global de idioma persistido en SQLite local (Español por defecto)
export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState<LanguageCode>(DEFAULT_LANGUAGE);

    useEffect(() => {
        getAppSetting(STORAGE_KEY)
            .then((saved) => {
                if (isSupportedLanguage(saved)) {
                    setLanguageState(saved);
                }
            })
            .catch(() => { });
    }, []);

    const setLanguage = useCallback((code: LanguageCode) => {
        if (!isSupportedLanguage(code)) return;
        setLanguageState(code);
        setAppSetting(STORAGE_KEY, code).catch(() => { });
    }, []);

    const t = useCallback(
        (key: TranslationKey, params?: TranslationParams) => translate(language, key, params),
        [language]
    );

    const localeTag = useMemo(() => getLanguageMeta(language).localeTag, [language]);

    const value = useMemo<LanguageContextValue>(
        () => ({
            language,
            localeTag,
            supportedLanguages: SUPPORTED_LANGUAGES,
            setLanguage,
            t,
        }),
        [language, localeTag, setLanguage, t]
    );

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useI18n(): LanguageContextValue {
    const ctx = useContext(LanguageContext);
    if (!ctx) {
        throw new Error('useI18n debe usarse dentro de LanguageProvider');
    }
    return ctx;
}
