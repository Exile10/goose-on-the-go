/** Bundled connection messages: no translation service or network dependency. */
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false },
  resources: { en: { translation: {
    remote: {
      title: 'Access your Pond from anywhere', description: 'Keep using your Pond away from home through an encrypted private connection. Your Pond must approve remote access locally.',
      continue: 'Set up', notNow: 'Not now', enable: 'Enable remote access', localOnly: 'Keep local only', done: 'Go to Home',
      unconfigured: 'Remote access is not set up on this Pond yet. Its operator must configure the coordination and relay service before cellular access can work. Local pairing is ready to use.',
      approval: 'Approve remote access on your Pond, then try again.', enrolling: 'Registering this device', connecting: 'Checking remote access', enabled: 'Remote access enabled',
      failed: 'Remote access could not be enabled. Your local pairing is preserved.', cancelled: 'Remote access setup was cancelled.',
      recover: 'Recover remote access after local re-pairing',
      alreadyEnrolled: 'This phone is already set up for remote access. If you paired with your Pond again, use Recover below to re-issue its remote address.',
      replacementBlocked: 'Your Pond could not re-issue this phone\u2019s remote address. Try again in a moment, or sign out and pair again if it keeps failing.',
      review: 'Approve this recovery request on your Pond dashboard. Keep this phone on the home network.',
      reviewCode: 'Match this request on the Pond: {{id}}',
      reviewExpired: 'Local approval expired. Request recovery again while on the home network.',
      busy: 'Remote access setup is already running.', unsupported: 'Remote access requires the latest native Goose app.',
    },
    connection: {
      changePond: 'Scan a local QR code to change the paired Pond.',
      local: 'Connected locally', remote: 'Connected remotely', reconnecting: 'Reconnecting to your Pond',
      disconnected: 'Pond is unavailable. Check its connection and remote access status.',
      unpaired: 'Pair with your Pond at home', upgrade: 'Scan a new QR code at home to enable secure connections.',
      revoked: 'Your Pond no longer recognises this phone. Tap to pair again at home.',
      trust: 'Could not verify this Pond. Check its fingerprint on the Pond before pairing again.',
      unsupported: 'Secure Pond connections require an Android or iOS development or release build.',
    },
    profile: {
      signOut: 'Sign Out', signingOut: 'Signing out...', cancel: 'Cancel',
      signOutWarning: 'This releases this phone\u2019s access to your Pond, including its remote access. You will need to pair again at home to come back.',
      signOutFailed: 'Could not sign out. Your Pond may be unreachable \u2014 try again when you are on its network.',
    },
    pairing: {
      lan: 'Connect to the same home network as your Pond to pair.',
      invalid: 'Scan a current HTTPS pairing QR code from your Pond.',
      fingerprint: 'Pond public-key fingerprint',
      fingerprintHint: 'Your Pond shows this on its dashboard, under Pairing.',
      fingerprintSearching: 'Looking for your Pond...',
      fingerprintMissing: 'This Pond did not publish its fingerprint on your network, so it has to be entered by hand this once.',
      failed: 'Could not pair securely with this Pond.',
      saving: 'Could not save this pairing. Your previous Pond is still selected.',
      address: 'HTTPS Pond address', code: 'Pairing code',
      // The local pairing wizard. Covered by the lint rule in eslint.config.js, so a bare
      // string added to pond-pairing.tsx or connect-desktop.tsx now fails the build.
      scanInstead: 'Scan QR code instead', enterManually: 'Enter address manually',
      searchingTitle: 'Looking for your Pond', searchingDesc: 'Searching this Wi-Fi network.',
      noneFound: 'No Pond answered on this network. Check that it is running and that this phone is on the same Wi-Fi, or enter its address below.',
      searchFailed: '{{error}} You can still enter the address by hand.', searchAgain: 'Search again',
      connectTitle: 'Connect to GIAP',
      connectDesc: 'Enter the URL of your Goose In A Pond server \u2014 shown in the dashboard banner on the host machine.',
      serverUrl: 'Server URL', continueAction: 'Continue',
      codeTitle: 'Enter Pairing Code',
      codeDesc: 'The 6-digit code is shown on the GIAP host\'s dashboard or terminal when the server starts. It expires after 10 minutes.',
      codeLabel: 'Code',
      nameTitle: 'Name This Phone',
      nameDesc: 'This name shows up in the GIAP devices list \u2014 pick something you\'ll recognize.',
      nameLabel: 'Device Name', namePlaceholder: 'e.g., Emmanuel\'s iPhone', pairDevice: 'Pair Device',
      inProgress: 'Pairing\u2026', inProgressDesc: 'Verifying the code and exchanging tokens with your GIAP server.',
      failedTitle: 'Pairing failed',
      failedDesc: 'The server rejected the pairing attempt. Double-check the code and try again.',
      tryAgain: 'Try again',
      // The desktop-pairing scanner.
      cameraTitle: 'Camera access needed',
      cameraDesc: 'Scanning the pairing code needs the camera. You can also enter the six digits by hand instead.',
      enableCamera: 'Enable Camera', openSettings: 'Open Settings', typeInstead: 'Enter the code instead',
      closeScanner: 'Close scanner', codeRejected: 'Could not use that code', scanAgain: 'Scan again',
      codeUnreadable: 'Could not read that code. Try again.',
      holdSteady: 'Hold steady\u2026', aimAtPond: 'Point the camera at the QR code on your Pond\'s dashboard',
    },
    // The Matter commissioning path. The rest of the copy on those two screens
    // is still hardcoded in the components; these are the strings this change
    // introduced, and new strings go here.
    commission: {
      scan: 'Scan the code instead', type: 'Type the code instead',
      aim: 'Point the camera at the QR code on the device or its packaging',
      camera: 'Scanning a device setup code needs the camera. You can also type the code printed on the device instead.',
      notSetupCode: 'That is not a Matter setup code. Look for a QR beginning MT: on the device or its box.',
      isPondCode: 'That is your Pond\u2019s pairing code, not a device setup code. This phone is already paired \u2014 scan the QR on the device itself, or on its packaging.',
    },
  } } },
});
export default i18n;
