/** User-facing product name. Internal keys (dayly.*, dayly_session) stay unchanged. */
export const APP_NAME = "Dayly";
export const APP_TAGLINE = "Tu agenda y centro de productividad.";
/** Visible app version. Bump patch (+0.0.1) on every deploy. Source of truth: this constant. */
export const APP_VERSION = "2.0.0";
/**
 * Version of the Windows (Tauri) wrapper. Independent of APP_VERSION so a web
 * patch does not require rebuilding the .exe. Bump only when the shell changes.
 */
export const SHELL_VERSION = "1.0.20";
/** Production URL the native shell always opens. */
export const PRODUCTION_URL = "https://tu-dominio.example";

/**
 * Public Spotify PKCE client id (not a secret). Baked in so login works
 * without a .env. Register the app at https://developer.spotify.com/dashboard
 * with redirect URIs:
 *   https://tu-dominio.example/spotify/callback
 *   http://127.0.0.1:5173/spotify/callback
 */
export const SPOTIFY_CLIENT_ID = "";
