# TODO

## Backlog
- [x] Add `debugLogging` toggle to config schema — when enabled, log raw API responses at info level so users can diagnose issues without needing Homebridge debug mode
- [x] Confirm correct status field names for IF31 pump and PLC1 light — confirmed from raw payload 2026-05-26: pump uses s14 (Active Program Number, 0=off, ≥1=running), light uses d13 (On/Off 0/1) and d1 (Light Mode/Color 1-12)
- [ ] Confirm correct command payload for IF31 stop — currently sends zp{N}e10='2' for programs 1–4; d25='0' may be more reliable (Stop/Start field)
- [ ] Look into why device names show as "Unknown" from the list-devices API
- [ ] Turn off debugLogging once status updates confirmed working
