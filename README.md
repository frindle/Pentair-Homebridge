# homebridge-pentair-cloud

[![npm version](https://img.shields.io/npm/v/homebridge-pentair-cloud)](https://www.npmjs.com/package/homebridge-pentair-cloud)
[![npm downloads](https://img.shields.io/npm/dm/homebridge-pentair-cloud)](https://www.npmjs.com/package/homebridge-pentair-cloud)

Homebridge plugin for Pentair pool equipment via the Pentair Home cloud API.

## Supported Devices

- **IntelliFlo VSF / Variable Speed Pump** (IF31) — on/off and speed control
- **IntelliBrite / Color Sync Light Controller** (PLC1) — on/off and color scene selection

## Installation

Search for **Pentair Cloud** in the Homebridge UI plugin search, or run:

```bash
npm install -g homebridge-pentair-cloud
```

## Configuration

Add to your Homebridge `config.json` under `platforms`:

```json
{
  "platform": "PentairHomebridge",
  "name": "Pentair Cloud",
  "email": "your@email.com",
  "password": "yourpassword",
  "pump": {
    "deviceId": "PNR08XXXXXXXXXX",
    "name": "Pool Pump"
  },
  "light": {
    "deviceId": "PNRAXXXXXXXXXX",
    "name": "Pool Light"
  }
}
```

**Finding device IDs:** On first startup, the plugin logs all devices found on your Pentair account with their IDs. Check the Homebridge log and copy the deviceId values into your config.

### Config Options

| Field | Required | Description |
|-------|----------|-------------|
| `email` | Yes | Pentair Home account email |
| `password` | Yes | Pentair Home account password |
| `pump` | No | Pump accessory config |
| `light` | No | Light accessory config |
| `pump.deviceId` | Yes (if pump set) | Pump device ID |
| `pump.name` | No | HomeKit display name (default: "Pool Pump") |
| `light.deviceId` | Yes (if light set) | Light device ID |
| `light.name` | No | HomeKit display name (default: "Pool Light") |

## HomeKit Behaviour

### Pump (Fanv2)

- **Active** — turn the pump on or off
- **RotationSpeed** — pump speed as a percentage:
  - 1–25% → Program 1 (low)
  - 26–50% → Program 2 (medium)
  - 51–75% → Program 3 (medium-high)
  - 76–100% → Program 4 (high)
  - 0% → off

### Light (Lightbulb)

- **On/Off** — toggle the light
- **Hue** — selects a color scene:
  - Red (0–20°) / Magenta (291–339°) / Purple (261–290°) / Blue (201–260°)
  - Teal/Caribbean (151–200°) / Green (61–150°) / Orange/Sunset (21–60°)
- **Saturation** — color intensity; < 20% selects White mode

## Troubleshooting

### Debug Logging

Enable debug logging to see raw API responses and diagnose issues:

```bash
# When starting homebridge
homebridge -D

# Or in config.json log level
"pluginMap": {
  "homebridge-pentair-cloud": {
    "debug": true
  }
}
```

Raw device status is logged at debug level in both pump and light accessories, which helps identify all status fields available from your device.

### Failed to authenticate: USER_PASSWORD_AUTH flow not enabled

Upgrade to **v1.1.2** or later. Versions before 1.1.2 used an authentication flow that the Pentair Cognito app client does not enable. v1.1.2 rewrites the auth layer to use the full SRP (`USER_SRP_AUTH`) flow.

### Siri Requests hang or timeout

v1.0.5+ includes a 10-second timeout on all API requests. If requests still time out, check your network connection to `api.pentair.cloud`.

### Device names show as "Unknown"

The device list API sometimes returns empty names. This is cosmetic and does not affect control — use device IDs to identify devices.

## Requirements

- Homebridge ≥ 1.6.0
- Node.js ≥ 18.0.0
- Active Pentair Home account with cloud-connected equipment

## How It Works

The plugin authenticates with Pentair Home via AWS Cognito (SRP auth), exchanges the ID token for temporary AWS credentials, then signs all API requests with AWS Signature V4.

API endpoints used:

| Operation | Endpoint |
|-----------|----------|
| List devices | `GET /device/device-service/user/devices` |
| Device status | `POST /device2/device2-service/user/device` |
| Send command | `PUT /device/device-service/user/device/{deviceId}` |

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

MIT