/**
 * PentairPumpAccessory – HomeKit accessory for a Pentair variable-speed pool pump.
 *
 * HomeKit service: Fan (v2) using the following characteristics:
 *  - Active        → whether the pump is running
 *  - RotationSpeed → 0–100 % mapped to pump programs 1–4
 *
 * Program mapping (speed → program):
 *  1 – 25 %  → Program 1
 *  26 – 50 % → Program 2
 *  51 – 75 % → Program 3
 *  76 – 100% → Program 4
 *
 * Cloud API payload format:
 *  Start program N: { "zp{N}e10": "3" }
 *  Stop  program N: { "zp{N}e10": "2" }
 */

import type {
  PlatformAccessory,
  CharacteristicValue,
  Service,
} from 'homebridge';
import type { PentairHomebridgePlatform } from '../platform';
import type { PentairApi } from '../pentairApi';
import { STATUS_POLL_INTERVAL_MS } from '../settings';

/** Configuration block expected under `config.pump`. */
export interface PumpConfig {
  deviceId: string;
  name: string;
}

/** Number of programs the Pentair pump exposes. */
const PROGRAM_COUNT = 4;

/**
 * Maps a HomeKit RotationSpeed percentage (1–100) to a pump program number
 * (1–4).  Returns 1 for any value ≤ 25, scaling up in 25-point bands.
 */
function speedToProgram(speed: number): number {
  if (speed <= 25) return 1;
  if (speed <= 50) return 2;
  if (speed <= 75) return 3;
  return 4;
}

/**
 * Returns the canonical speed percentage to represent a given program number
 * in HomeKit (midpoint of each band).
 */
function programToSpeed(program: number): number {
  switch (program) {
    case 1: return 12;   // midpoint of 1–25
    case 2: return 37;   // midpoint of 26–50
    case 3: return 62;   // midpoint of 51–75
    case 4: return 87;   // midpoint of 76–100
    default: return 0;
  }
}

/**
 * Homebridge accessory that bridges a Pentair variable-speed pump to HomeKit.
 *
 * The accessory is registered by `PentairHomebridgePlatform.discoverDevices()`
 * and restored across Homebridge restarts via the accessory cache.
 */
export class PentairPumpAccessory {
  private readonly service: Service;
  private readonly api: PentairApi;
  private readonly deviceId: string;
  private readonly platform: PentairHomebridgePlatform;
  private readonly accessory: PlatformAccessory;

  /** Locally cached state to avoid redundant cloud calls. */
  private state = {
    active: false,
    program: 1,
  };

  /** Handle for the polling interval so it can be cleared on teardown. */
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    platform: PentairHomebridgePlatform,
    accessory: PlatformAccessory,
    api: PentairApi,
    config: PumpConfig,
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
      .setCharacteristic(Char.Model, 'Variable Speed Pump')
      .setCharacteristic(Char.SerialNumber, config.deviceId);

    // ---------------------------------------------------------------------------
    // Fan service
    // ---------------------------------------------------------------------------
    this.service =
      this.accessory.getService(Svc.Fanv2) ??
      this.accessory.addService(Svc.Fanv2, config.name);

    // Active (on / off)
    this.service
      .getCharacteristic(Char.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    // RotationSpeed (0–100 %)
    this.service
      .getCharacteristic(Char.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.handleSpeedGet.bind(this))
      .onSet(this.handleSpeedSet.bind(this));

    // Begin polling.
    this.startPolling();
  }

  // ---------------------------------------------------------------------------
  // HomeKit characteristic handlers
  // ---------------------------------------------------------------------------

  /** Returns whether the pump is currently active. */
  private handleActiveGet(): CharacteristicValue {
    return this.state.active
      ? this.platform.hapApi.hap.Characteristic.Active.ACTIVE
      : this.platform.hapApi.hap.Characteristic.Active.INACTIVE;
  }

  /**
   * Turns the pump on or off.
   * On: starts the currently selected program.
   * Off: stops all programs.
   */
  private async handleActiveSet(value: CharacteristicValue): Promise<void> {
    const wantActive = value === this.platform.hapApi.hap.Characteristic.Active.ACTIVE;
    this.platform.log.info(
      `Pump [${this.deviceId}]: set active → ${wantActive}`,
    );

    const prevActive = this.state.active;
    try {
      if (wantActive) {
        await this.startProgram(this.state.program);
        this.state.active = true;
      } else {
        await this.stopAllPrograms();
        this.state.active = false;
      }
    } catch (err) {
      this.platform.log.error(`Pump [${this.deviceId}]: active set failed`, err);
      this.state.active = prevActive;
    }
  }

  /** Returns the rotation speed corresponding to the current program. */
  private handleSpeedGet(): CharacteristicValue {
    return this.state.active ? programToSpeed(this.state.program) : 0;
  }

  /**
   * Changes the pump speed by selecting the appropriate program.
   * If the pump is off and a non-zero speed is requested, it is turned on.
   */
  private async handleSpeedSet(value: CharacteristicValue): Promise<void> {
    const speed = value as number;
    if (speed === 0) {
      // Speed set to 0 means stop.
      await this.handleActiveSet(
        this.platform.hapApi.hap.Characteristic.Active.INACTIVE,
      );
      return;
    }

    const program = speedToProgram(speed);
    this.platform.log.info(
      `Pump [${this.deviceId}]: set speed ${speed}% → program ${program}`,
    );

    const prevProgram = this.state.program;
    const prevActive = this.state.active;
    try {
      await this.startProgram(program);
      this.state.program = program;
      this.state.active = true;
    } catch (err) {
      this.platform.log.error(`Pump [${this.deviceId}]: speed set failed`, err);
      this.state.program = prevProgram;
      this.state.active = prevActive;
    }
  }

  // ---------------------------------------------------------------------------
  // Cloud API helpers
  // ---------------------------------------------------------------------------

  /** Sends the start command to the cloud API (d25=1 = Enabled). */
  private async startProgram(_program: number): Promise<void> {
    await this.api.sendCommand(this.deviceId, { d25: '1' });
  }

  /** Sends the stop command to the cloud API (d25=0 = OFF). */
  private async stopAllPrograms(): Promise<void> {
    await this.api.sendCommand(this.deviceId, { d25: '0' });
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  /** Starts the periodic status polling loop. */
  private startPolling(): void {
    this.pollHandle = setInterval(
      () => this.pollStatus(),
      STATUS_POLL_INTERVAL_MS,
    );
    // Initial fetch immediately.
    this.pollStatus();
  }

  /**
   * Fetches device status from the cloud and updates HomeKit characteristics.
   * Failures are logged but do not throw, keeping the polling loop alive.
   */
  private async pollStatus(): Promise<void> {
    try {
      const status = await this.api.getDeviceStatus(this.deviceId);

      // s14 = Active Program Number (0 = none, ≥1 = running program index).
      const s14Raw = status['s14'];
      const s14 = parseInt(String(s14Raw ?? '0'), 10);
      const runningProgram = isNaN(s14) || s14 < 1 ? 0 : Math.min(s14, PROGRAM_COUNT);
      const isActive = runningProgram > 0;

      this.state.active = isActive;
      if (isActive) {
        this.state.program = runningProgram;
      }

      const { Characteristic: Char } = this.platform.hapApi.hap;
      this.service.updateCharacteristic(
        Char.Active,
        isActive ? Char.Active.ACTIVE : Char.Active.INACTIVE,
      );
      this.service.updateCharacteristic(
        Char.RotationSpeed,
        isActive ? programToSpeed(this.state.program) : 0,
      );
    } catch (err) {
      this.platform.log.warn(`Pump [${this.deviceId}]: status poll failed`, err);
    }
  }
}
