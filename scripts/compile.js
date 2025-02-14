import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import tar from 'tar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, '../dist');

// Removed unused pipe variable

// Function to calculate SHA256 checksum
function calculateSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

// Function to create checksums.sha256 file
function createChecksumsFile() {
  const checksumsFilePath = path.join(outputDir, 'checksums.sha256');
  const files = fs
    .readdirSync(outputDir)
    .filter((file) => file.endsWith('.tar.gz'));

  const checksums = files
    .map((file) => {
      const filePath = path.join(outputDir, file);
      const checksum = calculateSha256(filePath);
      return `${checksum} *${file}`;
    })
    .join('\n');

  fs.writeFileSync(checksumsFilePath, checksums);
  console.log('Created checksums.sha256 successfully.');
}

// Function to rename folders, compress them into tar.gz, and delete the originals
async function processLinuxFolders() {
  const folders = [
    { oldName: 'linux-unpacked', newName: 'linux-amd64' },
    { oldName: 'linux-arm64-unpacked', newName: 'linux-arm64' },
  ];

  for (const { oldName, newName } of folders) {
    const oldPath = path.join(outputDir, oldName);
    const newPath = path.join(outputDir, newName);
    const tarGzPath = `${newPath}.tar.gz`;

    if (fs.existsSync(oldPath)) {
      console.log(`Processing folder: ${oldName}`);
      try {
        fs.renameSync(oldPath, newPath);
        console.log(`Renamed to: ${newName}`);

        console.log(`Compressing ${newName} to ${tarGzPath}`);
        await tar.c(
          {
            gzip: true,
            file: tarGzPath,
            cwd: outputDir,
          },
          [newName],
        );
        console.log(`Compressed to: ${tarGzPath}`);

        fs.rmSync(newPath, { recursive: true, force: true });
        console.log(`Deleted folder: ${newName}`);
      } catch (error) {
        console.error(`Error processing ${oldName}: ${error.message}`);
      }
    } else {
      console.warn(`Folder not found: ${oldName}`);
    }
  }
}

// Function to clean up unnecessary files and folders
function cleanup() {
  const items = [
    'builder-debug.yml',
    'builder-effective-config.yaml',
    'mac-universal',
    'win-unpacked',
    'win-arm64-unpacked',
  ];

  for (const item of items) {
    const itemPath = path.join(outputDir, item);

    if (fs.existsSync(itemPath)) {
      try {
        if (fs.lstatSync(itemPath).isDirectory()) {
          fs.rmSync(itemPath, { recursive: true, force: true });
          console.log(`Removed folder: ${item}`);
        } else {
          fs.unlinkSync(itemPath);
          console.log(`Removed file: ${item}`);
        }
      } catch (error) {
        console.error(`Error deleting ${item}: ${error.message}`);
      }
    } else {
      console.warn(`Item not found: ${item}`);
    }
  }
}

// Main function to handle build process
function main() {
  console.log('Starting build process...');

  // Use spawn instead of exec to capture real-time logs
  const builder = spawn('yarn', [
    'electron-builder',
    'build',
    '--config',
    'electron-builder.config.cjs',
    '--win',
    '--mac',
    '--linux',
    '--publish',
    'always',
  ]);

  // Pipe stdout to the console in real-time
  builder.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  // Pipe stderr to the console in real-time
  builder.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  // Handle build completion
  builder.on('close', async (code) => {
    if (code !== 0) {
      console.error(`Build failed with exit code ${code}`);
      return;
    }

    console.log('Build process completed successfully.');
    createChecksumsFile();
    await processLinuxFolders();
    cleanup();
  });

  builder.on('error', (error) => {
    console.error(`Error executing the build command: ${error.message}`);
  });
}

main();
