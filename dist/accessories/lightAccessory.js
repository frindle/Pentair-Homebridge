"use strict";
/**
 * PentairLightAccessory – HomeKit accessory for a Pentair IntelliBrite color light.
 *
 * HomeKit service: Lightbulb with the following characteristics:
 *  - On         → light on / off   (cloud field: lse)
 *  - Hue        → 0–360°           (cloud field: lco, Pentair color index)
 *  - Saturation → 0–100 %          (used to detect "white" mode: < 20% → White)
 *
 * Hue → Pentair color index mapping:
 *  0–20 or 340–360 → Red      (4)
 *  21–60           → Party    (5)   orange/warm range
 *  61–150          → Green    (3)
 *  151–200         → Caribbean(7)   teal
 *  201–260         → Blue     (2)
 *  261–290         → Romance  (6)   purple
 *  291–339         → Magenta  (1)
 *  Saturation < 20%→ White    (0)   (overrides hue)
 *
 * Cloud API payload fields:
 *  lse  – light on/off ("1" / "0")
 *  lco  – color index as string
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PentairLightAccessory = void 0;
const settings_1 = require("../settings");
/**
 * Representative hue values used when HomeKit asks for the current color.
 * These are midpoints of each range that maps back to the given Pentair color.
 */
const COLOR_TO_HUE = {
    [0 /* PentairColor.White */]: 0, // achromatic – saturation will be 0
    [1 /* PentairColor.Magenta */]: 315,
    [2 /* PentairColor.Blue */]: 230,
    [3 /* PentairColor.Green */]: 100,
    [4 /* PentairColor.Red */]: 10,
    [5 /* PentairColor.Party */]: 40,
    [6 /* PentairColor.Romance */]: 275,
    [7 /* PentairColor.Caribbean */]: 175,
    [8 /* PentairColor.American */]: 210, // treated as blue-ish when mapping back
    [9 /* PentairColor.Sunset */]: 25, // warm orange-red
};
/**
 * Converts a HomeKit Hue (0–360) and Saturation (0–100) to a Pentair color
 * index.
 */
function hueToColorIndex(hue, saturation) {
    if (saturation < 20)
        return 0 /* PentairColor.White */;
    // Normalise hue to [0, 360)
    const h = ((hue % 360) + 360) % 360;
    if (h <= 20 || h >= 340)
        return 4 /* PentairColor.Red */;
    if (h <= 60)
        return 5 /* PentairColor.Party */;
    if (h <= 150)
        return 3 /* PentairColor.Green */;
    if (h <= 200)
        return 7 /* PentairColor.Caribbean */;
    if (h <= 260)
        return 2 /* PentairColor.Blue */;
    if (h <= 290)
        return 6 /* PentairColor.Romance */;
    /* 291–339 */ return 1 /* PentairColor.Magenta */;
}
/**
 * Homebridge accessory that bridges a Pentair IntelliBrite light to HomeKit.
 *
 * Registered and restored by `PentairHomebridgePlatform.discoverDevices()`.
 */
class PentairLightAccessory {
    constructor(platform, accessory, api, config) {
        /** Locally cached state to avoid redundant cloud round-trips. */
        this.state = {
            on: false,
            colorIndex: 0 /* PentairColor.White */,
        };
        /** Derived hue/saturation so HomeKit reads are consistent with color index. */
        this.hue = 0;
        this.saturation = 0;
        this.pollHandle = null;
        /**
         * Handles hue changes from HomeKit.  Defers sending until both hue and
         * saturation are known.  Uses a short debounce so rapid slider moves
         * don't flood the cloud API.
         */
        this.hueSetDebounce = null;
        this.platform = platform;
        this.accessory = accessory;
        this.api = api;
        this.deviceId = config.deviceId;
        const { Service: Svc, Characteristic: Char } = this.platform.hapApi.hap;
        // ---------------------------------------------------------------------------
        // Accessory information service
        // ---------------------------------------------------------------------------
        this.accessory
            .getService(Svc.AccessoryInformation)
            .setCharacteristic(Char.Manufacturer, 'Pentair')
            .setCharacteristic(Char.Model, 'IntelliBrite Color Light')
            .setCharacteristic(Char.SerialNumber, config.deviceId);
        // ---------------------------------------------------------------------------
        // Lightbulb service
        // ---------------------------------------------------------------------------
        this.service =
            this.accessory.getService(Svc.Lightbulb) ??
                this.accessory.addService(Svc.Lightbulb, config.name);
        // On / Off
        this.service
            .getCharacteristic(Char.On)
            .onGet(this.handleOnGet.bind(this))
            .onSet(this.handleOnSet.bind(this));
        // Hue
        this.service
            .getCharacteristic(Char.Hue)
            .onGet(this.handleHueGet.bind(this))
            .onSet(this.handleHueSet.bind(this));
        // Saturation
        this.service
            .getCharacteristic(Char.Saturation)
            .onGet(this.handleSaturationGet.bind(this))
            .onSet(this.handleSaturationSet.bind(this));
        this.startPolling();
    }
    // ---------------------------------------------------------------------------
    // HomeKit characteristic handlers
    // ---------------------------------------------------------------------------
    handleOnGet() {
        return this.state.on;
    }
    async handleOnSet(value) {
        const on = value;
        this.platform.log.info(`Light [${this.deviceId}]: set on → ${on}`);
        try {
            await this.api.sendCommand(this.deviceId, { lse: on ? '1' : '0' });
            this.state.on = on;
        }
        catch (err) {
            this.platform.log.error(`Light [${this.deviceId}]: on/off set failed`, err);
            throw err;
        }
    }
    handleHueGet() {
        return this.hue;
    }
    handleHueSet(value) {
        this.hue = value;
        if (this.hueSetDebounce)
            clearTimeout(this.hueSetDebounce);
        this.hueSetDebounce = setTimeout(() => {
            this.applyColorChange().catch((err) => {
                this.platform.log.error(`Light [${this.deviceId}]: hue set failed`, err);
            });
        }, 300);
    }
    handleSaturationGet() {
        return this.saturation;
    }
    handleSaturationSet(value) {
        this.saturation = value;
        // Re-use the same debounce as hue so combined changes fire one command.
        if (this.hueSetDebounce)
            clearTimeout(this.hueSetDebounce);
        this.hueSetDebounce = setTimeout(() => {
            this.applyColorChange().catch((err) => {
                this.platform.log.error(`Light [${this.deviceId}]: saturation set failed`, err);
            });
        }, 300);
    }
    // ---------------------------------------------------------------------------
    // Cloud API helpers
    // ---------------------------------------------------------------------------
    /**
     * Derives the Pentair color index from the current hue/saturation and sends
     * the `lco` command to the cloud API.
     */
    async applyColorChange() {
        const colorIndex = hueToColorIndex(this.hue, this.saturation);
        this.platform.log.info(`Light [${this.deviceId}]: set color → ${colorIndex} ` +
            `(hue=${this.hue}, sat=${this.saturation})`);
        await this.api.sendCommand(this.deviceId, {
            lco: String(colorIndex),
        });
        this.state.colorIndex = colorIndex;
    }
    // ---------------------------------------------------------------------------
    // Polling
    // ---------------------------------------------------------------------------
    startPolling() {
        this.pollHandle = setInterval(() => this.pollStatus(), settings_1.STATUS_POLL_INTERVAL_MS);
        this.pollStatus();
    }
    /**
     * Fetches device status and propagates changes to HomeKit characteristics.
     */
    async pollStatus() {
        try {
            const status = await this.api.getDeviceStatus(this.deviceId);
            this.platform.log.debug(`Light [${this.deviceId}] raw status: ${JSON.stringify(status)}`);
            // Parse on/off state.
            const lseRaw = status['lse'];
            const isOn = lseRaw === '1' || lseRaw === 1 || lseRaw === true;
            // Parse color index.
            const lcoRaw = status['lco'];
            let colorIndex = this.state.colorIndex;
            if (lcoRaw !== undefined && lcoRaw !== null) {
                const parsed = parseInt(String(lcoRaw), 10);
                if (!isNaN(parsed) && parsed >= 0 && parsed <= 9) {
                    colorIndex = parsed;
                }
            }
            const prevOn = this.state.on;
            const prevColor = this.state.colorIndex;
            this.state.on = isOn;
            this.state.colorIndex = colorIndex;
            // Derive hue/saturation from color index for HomeKit.
            const newHue = COLOR_TO_HUE[colorIndex] ?? 0;
            const newSat = colorIndex === 0 /* PentairColor.White */ ? 0 : 100;
            const { Characteristic: Char } = this.platform.hapApi.hap;
            if (prevOn !== isOn) {
                this.service.updateCharacteristic(Char.On, isOn);
            }
            if (prevColor !== colorIndex) {
                this.hue = newHue;
                this.saturation = newSat;
                this.service.updateCharacteristic(Char.Hue, newHue);
                this.service.updateCharacteristic(Char.Saturation, newSat);
            }
        }
        catch (err) {
            this.platform.log.warn(`Light [${this.deviceId}]: status poll failed`, err);
        }
    }
}
exports.PentairLightAccessory = PentairLightAccessory;
