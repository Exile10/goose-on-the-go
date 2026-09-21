/** Bundled connection messages: no translation service or network dependency. */
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false },
  resources: { en: { translation: {
    remote: {
      title: 'Access your Pond from anywhere', description: 'Keep using your Pond away from home through an encrypted private connection. Your Pond must approve remote access locally.',
      continue: 'Choose remote access', enable: 'Enable remote access', localOnly: 'Keep local only', done: 'Go to Home',
      unconfigured: 'Remote access is not set up on this Pond yet. Its operator must configure the coordination and relay service before cellular access can work. Local pairing is ready to use.',
      approval: 'Approve remote access on your Pond, then try again.', enrolling: 'Registering this device', connecting: 'Checking remote access', enabled: 'Remote access enabled',
      failed: 'Remote access could not be enabled. Your local pairing is preserved.', cancelled: 'Remote access setup was cancelled.',
      recover: 'Recover remote access after local re-pairing',
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
      trust: 'Could not verify this Pond. Check its fingerprint on the Pond before pairing again.',
      unsupported: 'Secure Pond connections require an Android or iOS development or release build.',
    },
    pairing: {
      lan: 'Connect to the same home network as your Pond to pair.',
      invalid: 'Scan a current HTTPS pairing QR code from your Pond.',
      fingerprint: 'Pond public-key fingerprint',
      fingerprintHint: 'Leave this empty and it fills itself from your network.',
      fingerprintSearching: 'Looking for this Pond on your network...',
      fingerprintFound: 'Fingerprint found on your network. Check it matches the one your Pond shows.',
      fingerprintMissing: 'This Pond did not answer on your network. Enter the fingerprint shown on its dashboard.',
      failed: 'Could not pair securely with this Pond.',
      saving: 'Could not save this pairing. Your previous Pond is still selected.',
      address: 'HTTPS Pond address', code: 'Pairing code',
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
