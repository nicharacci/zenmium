/**
 * Cloudflare Computer is the target sandbox for Goalpost factory runs.
 * Eve still boots Vercel Sandbox until an eve Computer backend exists.
 * Goalpost Code mounts Browser Profiles at this path. Cookie bytes never
 * enter FACTORY_REPO git or the factory brain.
 */
export const COMPUTER_BROWSER_PROFILE_MOUNT = "/home/agent/.gpc-chromium";
export const COMPUTER_CLIPS_MOUNT = "/home/agent/.gpc-clips";
