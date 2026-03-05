/**
 * Logo and branding config from environment.
 * Set VITE_LOGO_URL to an image URL (e.g. https://...) to use a custom logo.
 */
export const LOGO_URL = import.meta.env.VITE_LOGO_URL as string | undefined

export const APP_TITLE = import.meta.env.VITE_APP_TITLE as string | undefined ?? 'DataFrame'
