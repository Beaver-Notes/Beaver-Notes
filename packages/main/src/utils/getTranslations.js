// packages/main/src/utils/getTranslations.js
import { readFile } from 'fs/promises';
import { join } from 'path';

const localesPath = join(__dirname, '../../../packages/renderer/src/locales');

export async function getTranslations(lang = 'en') {
  const tryLoad = async (l) => {
    const file = await readFile(join(localesPath, `${l}.json`), 'utf-8');
    return JSON.parse(file);
  };

  try {
    return await tryLoad(lang);
  } catch {
    try {
      return await tryLoad('en');
    } catch (error) {
      console.error('Failed to load fallback translations:', error);
      return {};
    }
  }
}
