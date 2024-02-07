#!/bin/node
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

const targetLng = process.argv.slice(-1)[0];
const __dirname = new URL('.', import.meta.url).pathname;

if (targetLng === process.argv[1]) {
  console.log('Need Language.');
  process.exit(1);
}

function writeData(tips, path, data) {
  const rl = readline.createInterface(process.stdin, process.stdout);
  return new Promise((resolve) => {
    rl.question(tips, (anwser) => {
      if (anwser.toLocaleLowerCase()[0] === 'y') {
        fs.writeFileSync(path, JSON.stringify(data, null, 2));
        console.log('Writed!');
      }
      rl.close();
      resolve();
    });
  });
}

async function diffTranslation(localePath) {
  const enPath = path.resolve(__dirname, `${localePath}/en.json`);
  const targetPath = path.resolve(__dirname, `${localePath}/${targetLng}.json`);
  const enTranslation = JSON.parse(fs.readFileSync(enPath).toString());
  if (!fs.existsSync(targetPath)) {
    await writeData(`No such translation for ${targetLng}.\nCan you generate it on \x1b[31m${targetPath}\x1b[0m from English?y/[n]`, targetPath, enTranslation);
    return;
  }
  const targetTranslation = JSON.parse(fs.readFileSync(targetPath).toString());
  const [obj, diffObj] = diffObject(enTranslation, targetTranslation);
  if (Object.keys(diffObj).length > 0) {
    console.log('diff translation in ' + targetPath + ' is');
    console.log(diffObj);
    await writeData(`Overwrite ${targetLng}?y/[n]`, targetPath, Object.assign(targetTranslation, obj));
  } else {
    console.log('no diff in ' + targetPath);
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

await diffTranslation('../packages/renderer/src/pages/settings/locales');
await diffTranslation('../packages/renderer/src/utils/locales');
