// A long task's report, written to the cache under the Pond's file name and handed to the share sheet,
// as log export does. The file is overwritten by the next share of the same name and never read back.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { SharingUnavailableError } from './log-export';

export { SharingUnavailableError };

/** Resolves when the sheet closes. `name` has already been checked (`reportFileName`). */
export async function shareReportFile(name: string, body: string, type: { mimeType: string; uti: string }): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new SharingUnavailableError();
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(body);
  await Sharing.shareAsync(file.uri, { mimeType: type.mimeType, UTI: type.uti });
}
