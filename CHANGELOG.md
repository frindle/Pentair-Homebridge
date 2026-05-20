# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2026-05-20

### Fixed
- Pump `handleSpeedSet`: capture and revert both `program` and `active` state on command failure
- Light `handleOnSet`: remove optimistic state update (state now only updated by pollStatus to prevent brief HomeKit reverts)

### Security
- Add GitHub Actions workflow with npm trusted publishing (OIDC) — no token required, eliminates token compromise risk
- Remove `NPM_TOKEN` secret dependency from publish workflow
- Inherit all fixes from 1.0.9

## [1.0.9] - 2026-05-17

### Security
- **Remove `amazon-cognito-identity-js`** — replaced with pure Node.js `crypto` SRP-6a implementation using `@aws-sdk/client-cognito-identity-provider`. No more deprecated credential-handling package.
- Add `.npmignore` to exclude source files and dev artifacts from npm package
- Fix `config.schema.json`: add missing `required` array and `type` on `pump`/`light` objects for proper Homebridge UI validation

## [1.0.8] - 2026-05-17

### Security
- Cap API response body at 1 MB to prevent memory exhaustion from malicious responses
- Truncate API error body to 200 chars in logs to prevent internal details leaking
- Guard program number in `startProgram` with `Math.max/Math.min` bounds clamp

### Fixed
- Fix network error handling: fetch errors now throw a descriptive error instead of crashing with `TypeError: Cannot read properties of undefined`

## [1.0.7] - 2026-05-17

### Added
- CHANGELOG.md with full version history
- npm badges and package link in README

## [1.0.6] - 2026-05-17

### Added
- README with installation, configuration, and troubleshooting guide

## [1.0.5] - 2026-05-17

### Fixed
- 10-second timeout on all API requests — Siri commands no longer hang indefinitely when Pentair cloud is slow
- Added debug logging for raw device status in both pump and light accessories to aid diagnostics

## [1.0.4] - 2026-05-13

### Fixed
- Corrected status field name (`serialNumber`) and response envelope unwrapping in `getDeviceStatus`

## [1.0.1] - 2026-05-13

### Fixed
- Added `x-amz-id-token` and `user-agent` headers to all API requests (required by Pentair cloud)

## [1.0.0] - 2026-05-13

### Added
- Initial release
- Support for IntelliFlo VSF / Variable Speed Pump (IF31) — on/off and speed control via HomeKit Fan
- Support for IntelliBrite / Color Sync Light Controller (PLC1) — on/off and color scene selection via HomeKit Lightbulb
- AWS Cognito authentication (SRP auth) and SigV4 request signing