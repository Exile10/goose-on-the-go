/**
 * The embedded node's own logging, on request.
 *
 * A release build discards it, which is exactly backwards: the failures worth
 * diagnosing happen on a particular carrier, in a particular place, to somebody
 * who is not holding a laptop and cannot install a debuggable build. Twice in
 * one day a node that could not reach its coordinator failed with nothing to
 * look at.
 *
 * What reaches the system log is redacted before it leaves Go: the backend
 * announces the node-authorisation URL in plain text, and that URL is a bearer
 * capability for joining the household. `authURLPattern` in `node.go` keeps it
 * out, and this switch does not change that.
 *
 * Not remembered across a restart, deliberately. Diagnostics that quietly stay
 * on are a log nobody knows they are writing.
 */

import { NativeModules } from 'react-native';

/** Whether this build can route node logging anywhere. */
export function diagnosticsAvailable(): boolean {
  return typeof NativeModules.PondTls?.setDiagnostics === 'function';
}

export async function setDiagnostics(enabled: boolean): Promise<void> {
  if (!diagnosticsAvailable()) return;
  await NativeModules.PondTls.setDiagnostics(enabled);
}
