import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext — Cloudflare adapter config.
 * Required by `opennextjs-cloudflare build` (error "No `open-next.config.ts`
 * file was found in the project root" otherwise).
 *
 * We keep the default config (no R2 incremental cache): the webapp is fully
 * client-rendered and talks to the Stock Room API by URL, so no Cloudflare
 * bindings are used at runtime.
 *
 * See https://opennext.js.org/cloudflare/get-started
 */
export default defineCloudflareConfig({});
