/**
 * Types for react-native-zeroconf 0.14, which ships none.
 *
 * Only the browsing half is declared: publishing a service is the other half of
 * the library's API and this app has no reason to advertise itself. Declaring
 * what is used keeps a typo in an event name a compile error rather than a
 * listener that never fires, which is the failure this file exists to prevent.
 *
 * Field names below are taken from the Android NSD implementation
 * (`android/src/main/java/com/balthazargronon/RCTZeroconf/nsd/NsdServiceImpl.java`),
 * which is the default backend on both platforms.
 */

declare module 'react-native-zeroconf' {
  /** Which native backend to browse with. NSD is the default on Android. */
  export const ImplType: {
    readonly NSD: 'NSD';
    readonly DNSSD: 'DNSSD';
  };

  /**
   * A service as the native side reports it.
   *
   * Every field is optional because `found` fires with only a name, and a
   * resolve that fails still emits what it managed to read.
   */
  export interface Service {
    name?: string;
    fullName?: string;
    /** Host name; a `.local` name that Android's own resolver cannot resolve. */
    host?: string;
    port?: number;
    /** Numeric addresses, which is what can actually be dialled. */
    addresses?: string[];
    txt?: Record<string, unknown>;
  }

  export default class Zeroconf {
    constructor();

    /** Begin browsing. Defaults: `http`, `tcp`, `local.`, NSD. */
    scan(type?: string, protocol?: string, domain?: string, implType?: string): void;

    /** Stop browsing and release the multicast lock the scan acquired. */
    stop(implType?: string): void;

    /** Everything resolved so far, keyed by service name. */
    getServices(): Record<string, Service>;

    /** Drop the native listeners. Call after `stop` when discarding the instance. */
    removeDeviceListeners(): void;

    on(event: 'resolved', listener: (service: Service) => void): this;
    on(event: 'found' | 'remove', listener: (name: string) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'start' | 'stop' | 'update', listener: () => void): this;

    removeAllListeners(event?: string): this;
  }
}
