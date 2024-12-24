import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const outputDir = path.join(__dirname, 'dist'); // Adjust this if the output directory differs

// Run the electron-builder build command
console.log('Starting build...');
exec('yarn electron-builder build --config electron-builder.config.cjs --win', (error, stdout, stderr) => {
  if (error) {
    console.error(`Error during build: ${error.message}`);
    return;
  }

  if (stderr) {
    console.error(`Build stderr: ${stderr}`);
  }

  console.log('Build completed.');
  console.log(stdout);

  // Renaming x64 files
  console.log('Renaming x64 files...');
  fs.readdir(outputDir, (err, files) => {
    if (err) {
      console.error(`Error reading files from output directory: ${err.message}`);
      return;
    }

    files.forEach(file => {
      if (file.includes('.x64.')) {
        const newName = file.replace('.x64.', '.');
        const oldPath = path.join(outputDir, file);
        const newPath = path.join(outputDir, newName);

        fs.rename(oldPath, newPath, renameErr => {
          if (renameErr) {
            console.error(`Error renaming file ${file}: ${renameErr.message}`);
          } else {
            console.log(`Renamed: ${file} -> ${newName}`);
          }
        });
      }
    });
  });
});
