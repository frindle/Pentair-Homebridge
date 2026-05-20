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

import type {
  PlatformAccessory,
  CharacteristicValue,
  Service,
} from 'homebridge';
import type { PentairHomebridgePlatform } from '../platform';
import type { PentairApi } from '../pentairApi';
import { STATUS_POLL_INTERVAL_MS } from '../settings';

/** Configuration block expected under `config.light`. */
export interface LightConfig {
  deviceId: string;
  name: string;
}

/** All Pentair IntelliBrite color indices with their semantic names. */
export const enum PentairColor {
  White     = 0,
  Magenta   = 1,
  Blue      = 2,
  Green     = 3,
  Red       = 4,
  Party     = 5,
  Romance   = 6,
  Caribbean = 7,
  American  = 8,
  Sunset    = 9,
}

/**
 * Representative hue values used when HomeKit asks for the current color.
 * These are midpoints of each range that maps back to the given Pentair color.
 */
const COLOR_TO_HUE: Record<PentairColor, number> = {
  [PentairColor.White]:     0,    // achromatic – saturation will be 0
  [PentairColor.Magenta]: 315,
  [PentairColor.Blue]:    230,
  [PentairColor.Green]:    100,
  [PentairColor.Red]:       10,
  [PentairColor.Party]:     40,
  [PentairColor.Romance]: 275,
  [PentairColor.Caribbean]: 175,
  [PentairColor.American]:  210, // treated as blue-ish when mapping back
  [PentairColor.Sunset]:    25,  // warm orange-red
};

/**
 * Converts a HomeKit Hue (0–360) and Saturation (0–100) to a Pentair color
 * index.
 */
function hueToColorIndex(hue: number, saturation: number): PentairColor {
  if (saturation < 20) return PentairColor.White;

  // Normalise hue to [0, 360)
  const h = ((hue % 360) + 360) % 360;

  if (h <= 20 || h >= 340)   return PentairColor.Red;
  if (h <= 60)                return PentairColor.Party;
  if (h <= 150)               return PentairColor.Green;
  if (h <= 200)               return PentairColor.Caribbean;
  if (h <= 260)               return PentairColor.Blue;
  if (h <= 290)               return PentairColor.Romance;
  /* 291–339 */               return PentairColor.Magenta;
}

/**
 * Homebridge accessory that bridges a Pentair IntelliBrite light to HomeKit.
 *
 * Registered and restored by `PentairHomebridgePlatform.discoverDevices()`.
 */
export class PentairLightAccessory {
  private readonly service: Service;
  private readonly api: PentairApi;
  private readonly deviceId: string;
  private readonly platform: PentairHomebridgePlatform;
  private readonly accessory: PlatformAccessory;

  /** Locally cached state to avoid redundant cloud round-trips. */
  private state = {
    on: false,
    colorIndex: PentairColor.White as PentairColor,
  };

  /** Derived hue/saturation so HomeKit reads are consistent with color index. */
  private hue = 0;
  private saturation = 0;

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    platform: PentairHomebridgePlatform,
    accessory: PlatformAccessory,
    api: PentairApi,
    config: LightConfig,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.api = api;
    this.deviceId = config.deviceId;

    const { Service: Svc, Characteristic: Char } = this.platform.hapApi.hap;

    // ---------------------------------------------------------------------------
    // Accessory information service
    // ---------------------------------------------------------------------------
    this.accessory
      .getService(Svc.AccessoryInformation)!
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

  private handleOnGet(): CharacteristicValue {
    return this.state.on;
  }

  private async handleOnSet(value: CharacteristicValue): Promise<void> {
    const on = value as boolean;
    this.platform.log.info(`Light [${this.deviceId}]: set on → ${on}`);
    try {
      await this.api.sendCommand(this.deviceId, { lse: on ? '1' : '0' });
    } catch (err) {
      this.platform.log.error(`Light [${this.deviceId}]: on/off set failed`, err);
    }
  }

  private handleHueGet(): CharacteristicValue {
    return this.hue;
  }

  /**
   * Handles hue changes from HomeKit.  Defers sending until both hue and
   * saturation are known.  Uses a short debounce so rapid slider moves
   * don't flood the cloud API.
   */
  private hueSetDebounce: ReturnType<typeof setTimeout> | null = null;

  private handleHueSet(value: CharacteristicValue): void {
    this.hue = value as number;

    if (this.hueSetDebounce) clearTimeout(this.hueSetDebounce);
    this.hueSetDebounce = setTimeout(() => {
      this.applyColorChange().catch((err) => {
        this.platform.log.error(`Light [${this.deviceId}]: hue set failed`, err);
      });
    }, 300);
  }

  private handleSaturationGet(): CharacteristicValue {
    return this.saturation;
  }

  private handleSaturationSet(value: CharacteristicValue): void {
    this.saturation = value as number;
    // Re-use the same debounce as hue so combined changes fire one command.
    if (this.hueSetDebounce) clearTimeout(this.hueSetDebounce);
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
  private async applyColorChange(): Promise<void> {
    const colorIndex = hueToColorIndex(this.hue, this.saturation);
    this.platform.log.info(
      `Light [${this.deviceId}]: set color → ${colorIndex} ` +
      `(hue=${this.hue}, sat=${this.saturation})`,
    );

    await this.api.sendCommand(this.deviceId, {
      lco: String(colorIndex),
    });

    this.state.colorIndex = colorIndex;
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private startPolling(): void {
    this.pollHandle = setInterval(
      () => this.pollStatus(),
      STATUS_POLL_INTERVAL_MS,
    );
    this.pollStatus();
  }

  /**
   * Fetches device status and propagates changes to HomeKit characteristics.
   */
  private async pollStatus(): Promise<void> {
    try {
      const status = await this.api.getDeviceStatus(this.deviceId);

      // Parse on/off state.
      const lseRaw = status['lse'];
      const isOn =
        lseRaw === '1' || lseRaw === 1 || lseRaw === true;

      // Parse color index.
      const lcoRaw = status['lco'];
      let colorIndex: PentairColor = this.state.colorIndex;
      if (lcoRaw !== undefined && lcoRaw !== null) {
        const parsed = parseInt(String(lcoRaw), 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 9) {
          colorIndex = parsed as PentairColor;
        }
      }

      const prevOn = this.state.on;
      const prevColor = this.state.colorIndex;

      this.state.on = isOn;
      this.state.colorIndex = colorIndex;

      // Derive hue/saturation from color index for HomeKit.
      const newHue = COLOR_TO_HUE[colorIndex] ?? 0;
      const newSat = colorIndex === PentairColor.White ? 0 : 100;

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
    } catch (err) {
      this.platform.log.warn(`Light [${this.deviceId}]: status poll failed`, err);
    }
  }
}
