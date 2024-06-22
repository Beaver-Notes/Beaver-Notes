#!/bin/node
import { loadEnv } from '../env.js';

import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';
import readline from 'node:readline';

loadEnv('private');
const API_BASE_URL = 'https://translate-beaver.duckdns.org/api/v1';
const PROJECT_ID = process.env.PROJECT_ID.trim();
const CLIENT_ID = process.env.CLIENT_ID.trim();
const CLIENT_SECRET = process.env.CLIENT_SECRET.trim();
const LOCALES_DIR = './packages/renderer/src/pages/settings/locales';

async function getAuthToken() {
  const response = await fetch(`${API_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to obtain auth token');
  }

  const data = await response.json();
  return data.access_token;
}

async function listTranslations(token) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${PROJECT_ID}/translations`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error('Failed to list translations');
  }

  const data = await response.json();
  return data.data;
}

async function downloadTranslation(token, localeCode) {
  const response = await fetch(
    `${API_BASE_URL}/projects/${PROJECT_ID}/exports?locale=${localeCode}&format=jsonnested`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to download translation for locale: ${localeCode}`);
  }

  const data = await response.json();
  return data;
}

function saveTranslationFile(localeCode, data) {
  const shortLocaleCode = localeCode.includes('_')
    ? localeCode.split('_')[0]
    : localeCode;
  const filePath = path.join(LOCALES_DIR, `${shortLocaleCode}.json`);

  if (!fs.existsSync(LOCALES_DIR)) {
    fs.mkdirSync(LOCALES_DIR, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(
    `Saved translation file for locale: ${shortLocaleCode} at ${filePath}`,
  );
}

function askUserForLanguage(translations) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('Available languages:');
    translations.forEach((translation, index) => {
      const { language, code } = translation.locale;
      console.log(`${index + 1}. ${language} (${code})`);
    });
    console.log(`${translations.length + 1}. Download all languages`);

    rl.question('Please select a language by number or type q to quit: ', (answer) => {
      if (answer === 'q') {
        rl.close();
        console.log('quit');
        return;
      }
      const index = parseInt(answer, 10) - 1;
      if (index === translations.length) {
        resolve('all');
      } else if (index >= 0 && index < translations.length) {
        resolve(translations[index].locale.code);
      } else {
        console.log('Invalid selection. Exiting.');
        process.exit(1);
      }
      rl.close();
    });
  });
}

async function main() {
  try {
    const token = await getAuthToken();
    console.log('Auth token obtained successfully.');
    const translations = await listTranslations(token);
    console.log('Translations listed successfully.');

    const selectedLocale = await askUserForLanguage(translations);
    if (selectedLocale === 'all') {
      for (const translation of translations) {
        const { code } = translation.locale;
        const translationData = await downloadTranslation(token, code);
        saveTranslationFile(code, translationData);
      }
      console.log('All translations downloaded and saved successfully.');
    } else {
      const translation = await downloadTranslation(token, selectedLocale);
      console.log('Translation downloaded successfully.');
      saveTranslationFile(selectedLocale, translation);
      console.log('Translation downloaded and saved successfully.');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
