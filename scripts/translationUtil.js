import path from 'node:path';
import fs from 'node:fs';

const targetLng = process.argv.slice(-1)[0];
const __dirname = new URL('.', import.meta.url).pathname;

if (targetLng === process.argv[1]) {
  console.log('Need Language.');
  process.exit(1);
}

function highlightText(text) {
  return `\x1b[33m${text}\x1b[0m`; // Yellow color
}

async function showUnsynchronized(localePath) {
  const enPath = path.resolve(__dirname, `${localePath}/en.json`);
  const targetPath = path.resolve(__dirname, `${localePath}/${targetLng}.json`);
  
  if (!fs.existsSync(enPath)) {
    console.log(`\n${highlightText('Error:')} English translation file (${enPath}) not found.`);
    return;
  }

  if (!fs.existsSync(targetPath)) {
    console.log(`\n${highlightText(`No translation found for ${targetLng}`)}.`);
    console.log(`Run ${highlightText('yarn run update-tran')} to update.`);
    return;
  }

  const enTranslation = JSON.parse(fs.readFileSync(enPath).toString());
  const targetTranslation = JSON.parse(fs.readFileSync(targetPath).toString());
  
  const [ diffObj] = diffObject(enTranslation, targetTranslation);
  
  if (Object.keys(diffObj).length > 0) {
    console.log(`\n${highlightText(`Unsynchronized translations for ${targetLng}:`)}`);
    console.log(diffObj);
    console.log(`Run ${highlightText('yarn run tran-update')} to update.`);
  } else {
    console.log(`\nTranslations for ${targetLng} are synchronized.`);
  }
}

function diffObject(source, target) {
  const obj = {};
  const diffObj = {};
  for(const key in source) {
    if (typeof source[key] !== typeof target[key]) {
      diffObj[key] = obj[key] = source[key];
      continue;
    }
    if (typeof target[key] === 'string') {
      obj[key] = target[key];
      continue;
    }
    const [totalObj, subObj] = diffObject(source[key], target[key]);
    if (Object.keys(subObj).length !== 0) {
      Object.assign(diffObj, {
        [key]: subObj,
      });
    }
    Object.assign(obj, {
      [key]: totalObj,
    });
  }
  return [obj, diffObj];
}

showUnsynchronized('../packages/renderer/src/pages/settings/locales');
