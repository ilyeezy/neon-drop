// Все тексты — через t(key); хардкод-строк в разметке нет (ТЗ п. 11).
import ru from './ru.js';
import en from './en.js';

const dicts = { ru, en };
let current = 'ru';

export const LANGS = [
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'English' },
];

export function setLang(lang) {
  current = dicts[lang] ? lang : 'en';
}

export function getLang() {
  return current;
}

export function t(key, params) {
  let s = dicts[current][key] ?? dicts.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
