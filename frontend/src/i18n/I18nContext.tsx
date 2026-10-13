import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ko, TranslationType } from './locales/ko';
import { en } from './locales/en';

export type Language = 'ko' | 'en';

const STORAGE_KEY = 'praxis_lang';
const LEGACY_STORAGE_KEY = 'promptmacro_lang';

/**
 * 최초 실행 시 사용자 PC의 언어 및 지역을 감지
 * 대한민국('ko', 'ko-KR', 'Asia/Seoul')이면 'ko', 그 외 모든 지역은 'en'
 */
export function detectUserLocale(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') {
      return saved as Language;
    }

    // 1) 브라우저 / OS 언어 확인
    const navLangs = navigator.languages || [navigator.language || ''];
    const hasKoreanLang = navLangs.some((lang) => {
      const lower = (lang || '').toLowerCase();
      return lower.startsWith('ko') || lower.includes('kr');
    });

    // 2) 시스템 타임존 확인 (Asia/Seoul)
    const timeZone = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase();
    const isKoreanTimeZone = timeZone.includes('seoul') || timeZone.includes('korea');

    if (hasKoreanLang || isKoreanTimeZone) {
      return 'ko';
    }

    return 'en';
  } catch (e) {
    console.warn('[i18n] Failed to detect user locale, falling back to en:', e);
    return 'en';
  }
}

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (path: string, params?: Record<string, string | number>) => string;
  translations: TranslationType;
}

const I18nContext = createContext<I18nContextType | null>(null);

const dictionary: Record<Language, TranslationType> = {
  ko,
  en,
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => detectUserLocale());

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      console.error('[i18n] Failed to persist language to localStorage:', e);
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next: Language = prev === 'ko' ? 'en' : 'ko';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        console.error('[i18n] Failed to persist language to localStorage:', e);
      }
      return next;
    });
  }, []);

  // t('section.subSection.key', { count: 3 })
  const t = useCallback(
    (path: string, params?: Record<string, string | number>): string => {
      const keys = path.split('.');
      let current: any = dictionary[language];

      for (const k of keys) {
        if (current && typeof current === 'object' && k in current) {
          current = current[k];
        } else {
          // 폴백: 한국어 사전에서 조회
          let fallback: any = dictionary.ko;
          for (const fbKey of keys) {
            if (fallback && typeof fallback === 'object' && fbKey in fallback) {
              fallback = fallback[fbKey];
            } else {
              fallback = undefined;
              break;
            }
          }
          current = fallback !== undefined ? fallback : path;
          break;
        }
      }

      if (typeof current !== 'string') {
        return path;
      }

      let result = current;
      if (params) {
        Object.entries(params).forEach(([paramKey, val]) => {
          result = result.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(val));
        });
      }

      return result;
    },
    [language]
  );

  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage,
        toggleLanguage,
        t,
        translations: dictionary[language],
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextType => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
};
