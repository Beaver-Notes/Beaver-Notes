import 'dotenv/config';
import { notarize } from '@electron/notarize';

/**
 * Notarize the macOS app using Apple ID credentials
 * @param {import('electron-builder').AfterSignContext} context
 */
export default async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') return;

  const hasAppleIdAuth =
    Boolean(process.env.APPLE_ID) &&
    Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD) &&
    Boolean(process.env.APPLE_TEAM_ID);

  if (!hasAppleIdAuth) {
    console.log(
      'Skipping notarization: missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID'
    );
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log('Notarizing', appPath, 'with Apple ID credentials...');

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
    tool: 'notarytool',
  });

  console.log('Notarization complete!');
}
