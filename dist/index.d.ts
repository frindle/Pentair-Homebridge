/**
 * Entry point for the homebridge-pentair-cloud plugin.
 *
 * Homebridge calls the default export of this module (as identified by the
 * `main` field in package.json) to register the plugin.  We register a single
 * dynamic platform using the canonical PLUGIN_NAME and PLATFORM_NAME constants
 * so that Homebridge can match the `"platform"` key in the user's config.json.
 */
import type { API } from 'homebridge';
/**
 * Registers the Pentair platform with Homebridge.
 *
 * @param api - The Homebridge API instance injected at load time.
 */
export default function (api: API): void;
