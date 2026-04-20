/**
 * PentairHomebridgePlatform – the top-level Homebridge dynamic platform.
 *
 * Responsible for:
 *  1. Authenticating with the Pentair Cloud via AWS Cognito.
 *  2. Creating a PentairApi client.
 *  3. Registering / restoring accessories for the pump and light defined in
 *     the Homebridge config.
 *
 * Example config.json block:
 * ```json
 * {
 *   "platform": "PentairHomebridge",
 *   "email": "user@example.com",
 *   "password": "s3cr3t",
 *   "pump": {
 *     "deviceId": "abc123",
 *     "name": "Pool Pump"
 *   },
 *   "light": {
 *     "deviceId": "def456",
 *     "name": "Pool Light"
 *   }
 * }
 * ```
 */
import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
/**
 * The main Homebridge platform class for the Pentair Cloud plugin.
 *
 * Homebridge instantiates this class once at startup, then calls
 * `didFinishLaunching` when the HAP server is ready to accept accessories.
 */
export declare class PentairHomebridgePlatform implements DynamicPlatformPlugin {
    /** Logger provided by Homebridge. */
    readonly log: Logger;
    /**
     * HAP API surface – exposes `Service`, `Characteristic`, and helpers.
     * Named `hapApi` to avoid shadowing the `api` parameter in the constructor.
     */
    readonly hapApi: API;
    /** Accessories restored from the Homebridge cache on previous runs. */
    private readonly cachedAccessories;
    private auth;
    private pentairApi;
    constructor(log: Logger, config: PlatformConfig, api: API);
    /**
     * Called by Homebridge for every accessory stored in its persistent cache.
     * We store the accessory so `discoverDevices` can decide to re-use or
     * replace it.
     */
    configureAccessory(accessory: PlatformAccessory): void;
    /**
     * Authenticates with Pentair Cloud and then discovers/registers accessories.
     */
    private initPlatform;
    /**
     * Registers the pump and light accessories defined in the plugin config.
     * Restores from the Homebridge cache when possible to preserve UUIDs.
     */
    private discoverDevices;
    /**
     * Creates or restores the pump accessory and attaches the handler class.
     */
    private registerPumpAccessory;
    /**
     * Creates or restores the light accessory and attaches the handler class.
     */
    private registerLightAccessory;
    /**
     * Removes any accessories that remain in the cache after registration is
     * complete.  These correspond to devices that were removed from the config.
     */
    private pruneStaleAccessories;
}
