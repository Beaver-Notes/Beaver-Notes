// packages/main/src/utils/getTranslations.js
import { readFile } from 'fs/promises';
import { join } from 'path';

const localesPath = join(
  __dirname,
  '../../../packages/renderer/src/assets/locales'
);

const fallbackTranslations = {
  commands: {
    newNote: 'New note',
  },
  settings: {
    updateTitle: 'Update in progress',
    updateDescription:
      'Please wait for the update download to complete before closing the app.',
    updateAvailable: 'Update available',
    installNow: 'Install now',
    later: 'Later',
  },
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, override) {
  if (!isObject(base)) return override;
  if (!isObject(override)) return base;

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] =
      key in merged && isObject(merged[key]) && isObject(value)
        ? mergeDeep(merged[key], value)
        : value;
  }
  return merged;
}

export async function getTranslations(lang = 'en') {
  const tryLoad = async (l) => {
    const file = await readFile(join(localesPath, `${l}.json`), 'utf-8');
    return JSON.parse(file);
  };

  let english = null;
  try {
    english = await tryLoad('en');
  } catch (error) {
    console.error('Failed to load English translations:', error);
  }

  let selected = null;
  if (lang !== 'en') {
    try {
      selected = await tryLoad(lang);
    } catch {
      // Ignore and use English/fallback
    }
  } else {
    selected = english;
  }

  return mergeDeep(
    fallbackTranslations,
    mergeDeep(english ?? {}, selected ?? {})
  );
}
