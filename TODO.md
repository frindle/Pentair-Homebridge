# TODO

## In Progress
- [ ] Fix pump on/off status detection (waiting on raw status payload from IF31)

## Backlog
- [ ] Add `debugLogging` toggle to config schema — when enabled, log raw API responses at info level so users can diagnose issues without needing Homebridge debug mode
- [ ] Confirm correct status field names for IF31 pump (zp1e13 etc) and PLC1 light (lse, lco)
- [ ] Confirm correct command payload format for IF31 and PLC1
- [ ] Look into why device names show as "Unknown" from the list-devices API
