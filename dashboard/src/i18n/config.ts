/**
 * i18n configuration for Dashboard
 * Uses i18next with react-i18next for internationalization
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations
import vi from '../locales/vi';
import en from '../locales/en';

export const defaultNS = 'common';
export const resources = {
  vi: { common: vi },
  en: { common: en },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already handles escaping
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
