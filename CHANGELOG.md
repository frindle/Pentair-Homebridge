# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.14] - 2026-05-21

### Fixed
- `getDeviceStatus`: correct request body is `{ deviceIds: [deviceId] }` — confirmed by probe; `{ deviceId }` and `{ serialNumber }` both return empty data

## [1.1.13] - 2026-05-21

### Changed
- Re-probe all 7 body variants but now log `body=<label> data.length=<N>` per attempt so we can identify which key actually returns data; first variant with non-empty data wins and is returned

## [1.1.12] - 2026-05-21

### Fixed
- `getDeviceStatus`: parse real device data from `POST /device2/device2-service/user/device` — response shape is `response.data[0].fields`, each field flattened to `key → value`
- Pump polling: replaced broken `zp${p}e13` ("program exists") loop with `s14` (Active Program Number) — was always showing pump as active
- Light polling: replaced non-existent `lse`/`lco` fields with `d13` (On/Off) and `d1` (Light Mode/Color)
- Light send commands: updated `lse`/`lco` → `d13`/`d1` to match PLC1 v2 API field names
- `PentairColor` enum: corrected values to match PLC1 v2 API (1=SAM, 2=Party, 3=Romance, 4=Caribbean, 5=American, 6=Sunset, 7=Royal, 8=Blue, 9=Green, 10=Red, 11=White, 12=Magenta)

## [1.1.11] - 2026-05-20

### Changed
- Expand status probe to 7 POST body variants (deviceId, serialNumber, deviceIds[], serialNumbers[], bare array, id, ids[]) — POST endpoint confirmed working, need correct body key to get non-empty data

## [1.1.10] - 2026-05-20

### Fixed
- Probe loop now catches per-variant errors so all 5 endpoint variants are tried even when earlier ones return 404

## [1.1.9] - 2026-05-20

### Changed
- Probe 5 endpoint variants to identify correct device status API path and method (temporary diagnostic)

## [1.1.8] - 2026-05-20

### Fixed
- Fix device status request body: was sending `serialNumber` but API expects `deviceId` — caused API to return empty `data[]` despite a success code, so device state was never populated

## [1.1.7] - 2026-05-20

### Changed
- Log full raw API response when device status returns empty or unexpected shape — needed to identify correct status field names for IF31 and PLC1

## [1.1.6] - 2026-05-20

### Fixed
- **Revert to `amazon-cognito-identity-js` for SRP authentication** — the custom pure-Node SRP implementation introduced in v1.0.9 has never shipped in a working state; every v1.1.x release was an attempt to fix it. The library handles the SRP math correctly by definition and was the last confirmed-working auth approach (v1.0.x era)
- Remove unused `@aws-sdk/client-cognito-identity-provider` dependency (was only needed by the custom SRP code)

## [1.1.5] - 2026-05-20

### Fixed
- Fix remaining SRP math bugs causing `NotAuthorizedException: Incorrect username or password`:
  - `k` constant reverted to `H(padHex(N) || padHex(g))` = SHA256(258 bytes) — matches `amazon-cognito-identity-js` exactly; the 257-byte version used in v1.1.4 was wrong
  - `x` inner hash now applies `padHex` to the SHA256 of `(poolName + userId + ':' + password)` before concatenation, matching the library's `hash()` method which returns `padHex(BigInteger.fromHex(SHA256_hex(str)))` and can produce 66-char hex when the hash's first nibble ≥ 8

## [1.1.4] - 2026-05-20

### Fixed
- Fix SRP math to match amazon-cognito-identity-js exactly, resolving `NotAuthorizedException: Incorrect username or password`:
  - `k` constant was using `padHex(N)` (adds a leading `0x00` byte since N's MSB ≥ 0x80), producing a different SHA-256 than Cognito expects; reverted to `SHA256(bytes_of(HEX_N + "02"))` which matches the library's 257-byte input
  - `x` computation was using raw SALT bytes; Cognito's server applies `padHex` to SALT (adds leading zero byte when SALT's first nibble ≥ 8) before hashing — missing this caused wrong `x` ~50% of the time
  - Inner hash in `x` is now concatenated as its 64-char hex string before decoding to bytes, matching `hexHash(padHex(salt) + sha256hex(poolName+userId+':'+pw))`

## [1.1.3] - 2026-05-20

### Fixed
- Remove erroneous `Session` guard in `fetchTokens` — Cognito does not return a `Session` field in `InitiateAuth` responses for the `USER_SRP_AUTH` flow, causing authentication to always fail with "PASSWORD_VERIFIER challenge missing session"

## [1.1.2] - 2026-05-20

### Fixed
- **Authentication completely rewritten** to implement the full Cognito SRP (`USER_SRP_AUTH`) flow correctly — resolves `InvalidParameterException: USER_PASSWORD_AUTH flow not enabled for this client`:
  - `modExp` was using `base ** exp % mod` — infeasible for 2048-bit exponents; replaced with square-and-multiply
  - `InitiateAuth` was sending `PASSWORD` instead of `SRP_A` (client's ephemeral public key `g^a mod N`)
  - `SALT` and `SRP_B` were decoded from base64; Cognito returns them as hex strings
  - Key derivation now uses HKDF with `'Caldera Derived Key'` info bytes, matching `amazon-cognito-identity-js`
  - Signature now uses `HMAC-SHA256(K, pool_name || userId || secret_block || timestamp)` per Cognito spec
  - Timestamp now formatted as `"EEE MMM D HH:mm:ss UTC YYYY"` (Cognito-required), not ISO 8601
  - `k` constant now computed with `padHex` (minimal two's-complement padding) to match Cognito's server-side value

## [1.1.1] - 2026-05-20

### Fixed
- Fix corrupted `HEX_N` RFC 5054 2048-bit prime constant
- Remove verbose debug dumps from `pollStatus`

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