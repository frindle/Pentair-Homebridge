"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PentairHomebridgePlatform = void 0;
const settings_1 = require("./settings");
const auth_1 = require("./auth");
const pentairApi_1 = require("./pentairApi");
const pumpAccessory_1 = require("./accessories/pumpAccessory");
const lightAccessory_1 = require("./accessories/lightAccessory");
/**
 * The main Homebridge platform class for the Pentair Cloud plugin.
 *
 * Homebridge instantiates this class once at startup, then calls
 * `didFinishLaunching` when the HAP server is ready to accept accessories.
 */
class PentairHomebridgePlatform {
    constructor(log, config, api) {
        /** Accessories restored from the Homebridge cache on previous runs. */
        this.cachedAccessories = new Map();
        this.log = log;
        this.hapApi = api;
        const cfg = config;
        if (!cfg.email || !cfg.password) {
            this.log.error(`${settings_1.PLUGIN_NAME}: "email" and "password" are required in the platform config.`);
            // Return early – platform will be inert.
            return;
        }
        this.auth = new auth_1.PentairAuth(cfg.email, cfg.password);
        this.pentairApi = new pentairApi_1.PentairApi(this.auth, this.log, cfg.debugLogging ?? false);
        // Homebridge fires this event once the HAP server is ready.
        this.hapApi.on('didFinishLaunching', () => {
            this.log.debug('didFinishLaunching');
            this.initPlatform(cfg).catch((err) => {
                this.log.error(`${settings_1.PLUGIN_NAME}: fatal error during startup`, err);
            });
        });
    }
    // ---------------------------------------------------------------------------
    // DynamicPlatformPlugin interface
    // ---------------------------------------------------------------------------
    /**
     * Called by Homebridge for every accessory stored in its persistent cache.
     * We store the accessory so `discoverDevices` can decide to re-use or
     * replace it.
     */
    configureAccessory(accessory) {
        this.log.debug(`Restoring cached accessory: ${accessory.displayName}`);
        this.cachedAccessories.set(accessory.UUID, accessory);
    }
    // ---------------------------------------------------------------------------
    // Private lifecycle helpers
    // ---------------------------------------------------------------------------
    /**
     * Authenticates with Pentair Cloud and then discovers/registers accessories.
     */
    async initPlatform(config) {
        try {
            this.log.info('Authenticating with Pentair Cloud…');
            await this.auth.authenticate();
            this.log.info('Pentair Cloud authentication successful.');
        }
        catch (err) {
            this.log.error('Failed to authenticate with Pentair Cloud. ' +
                'Please check your email and password in the plugin config.', err);
            return; // Cannot proceed without valid credentials.
        }
        // Log all devices found on the account so users can copy the correct
        // deviceId values into their config.json.
        try {
            const devices = await this.pentairApi.getDevices();
            const list = Array.isArray(devices) ? devices : devices.devices ?? [];
            this.log.info('─────────────────────────────────────────');
            this.log.info(`Found ${list.length} device(s) on your Pentair account:`);
            list.forEach((device, i) => {
                this.log.info(`  [${i + 1}] name: "${device['name'] ?? device['deviceName'] ?? 'Unknown'}" | ` +
                    `deviceId: "${device['deviceId'] ?? device['id'] ?? 'N/A'}" | ` +
                    `type: "${device['deviceType'] ?? device['type'] ?? 'N/A'}"`);
            });
            this.log.info('Copy the deviceId values above into your config.json.');
            this.log.info('─────────────────────────────────────────');
        }
        catch (err) {
            this.log.warn('Could not fetch device list for logging:', err);
        }
        this.discoverDevices(config);
    }
    /**
     * Registers the pump and light accessories defined in the plugin config.
     * Restores from the Homebridge cache when possible to preserve UUIDs.
     */
    discoverDevices(config) {
        if (config.pump) {
            this.registerPumpAccessory(config.pump);
        }
        else {
            this.log.debug('No pump config provided, skipping pump accessory.');
        }
        if (config.light) {
            this.registerLightAccessory(config.light);
        }
        else {
            this.log.debug('No light config provided, skipping light accessory.');
        }
        // Remove any cached accessories that are no longer in the config.
        this.pruneStaleAccessories(config);
    }
    /**
     * Creates or restores the pump accessory and attaches the handler class.
     */
    registerPumpAccessory(pumpConfig) {
        const uuid = this.hapApi.hap.uuid.generate(`${settings_1.PLUGIN_NAME}-pump-${pumpConfig.deviceId}`);
        let accessory = this.cachedAccessories.get(uuid);
        if (accessory) {
            this.log.info(`Restoring pump accessory: ${accessory.displayName}`);
            // Update display name in case the user changed it.
            accessory.displayName = pumpConfig.name;
            this.hapApi.updatePlatformAccessories([accessory]);
        }
        else {
            this.log.info(`Adding new pump accessory: ${pumpConfig.name}`);
            accessory = new this.hapApi.platformAccessory(pumpConfig.name, uuid);
            this.hapApi.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                accessory,
            ]);
        }
        // Attach the accessory handler.  This wires up characteristics and
        // starts status polling.
        new pumpAccessory_1.PentairPumpAccessory(this, accessory, this.pentairApi, pumpConfig);
        // Mark as seen so `pruneStaleAccessories` doesn't remove it.
        this.cachedAccessories.delete(uuid);
    }
    /**
     * Creates or restores the light accessory and attaches the handler class.
     */
    registerLightAccessory(lightConfig) {
        const uuid = this.hapApi.hap.uuid.generate(`${settings_1.PLUGIN_NAME}-light-${lightConfig.deviceId}`);
        let accessory = this.cachedAccessories.get(uuid);
        if (accessory) {
            this.log.info(`Restoring light accessory: ${accessory.displayName}`);
            accessory.displayName = lightConfig.name;
            this.hapApi.updatePlatformAccessories([accessory]);
        }
        else {
            this.log.info(`Adding new light accessory: ${lightConfig.name}`);
            accessory = new this.hapApi.platformAccessory(lightConfig.name, uuid);
            this.hapApi.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [
                accessory,
            ]);
        }
        new lightAccessory_1.PentairLightAccessory(this, accessory, this.pentairApi, lightConfig);
        this.cachedAccessories.delete(uuid);
    }
    /**
     * Removes any accessories that remain in the cache after registration is
     * complete.  These correspond to devices that were removed from the config.
     */
    pruneStaleAccessories(config) {
        // Determine which UUIDs are expected.
        const expectedUuids = new Set();
        if (config.pump) {
            expectedUuids.add(this.hapApi.hap.uuid.generate(`${settings_1.PLUGIN_NAME}-pump-${config.pump.deviceId}`));
        }
        if (config.light) {
            expectedUuids.add(this.hapApi.hap.uuid.generate(`${settings_1.PLUGIN_NAME}-light-${config.light.deviceId}`));
        }
        const stale = [];
        for (const [uuid, accessory] of this.cachedAccessories) {
            if (!expectedUuids.has(uuid)) {
                this.log.info(`Removing stale accessory from cache: ${accessory.displayName}`);
                stale.push(accessory);
            }
        }
        if (stale.length > 0) {
            this.hapApi.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        }
    }
}
exports.PentairHomebridgePlatform = PentairHomebridgePlatform;
