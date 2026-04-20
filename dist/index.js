"use strict";
/**
 * Entry point for the homebridge-pentair-cloud plugin.
 *
 * Homebridge calls the default export of this module (as identified by the
 * `main` field in package.json) to register the plugin.  We register a single
 * dynamic platform using the canonical PLUGIN_NAME and PLATFORM_NAME constants
 * so that Homebridge can match the `"platform"` key in the user's config.json.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const settings_1 = require("./settings");
const platform_1 = require("./platform");
/**
 * Registers the Pentair platform with Homebridge.
 *
 * @param api - The Homebridge API instance injected at load time.
 */
function default_1(api) {
    api.registerPlatform(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, platform_1.PentairHomebridgePlatform);
}
