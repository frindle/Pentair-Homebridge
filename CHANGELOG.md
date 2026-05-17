# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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