// DEPRECADO: la API key de Anthropic ya NO viaja al cliente.
// Todas las llamadas pasan por el proxy server-side /api/anthropic, que usa la
// env var ANTHROPIC_API_KEY (SIN prefijo VITE_) y por lo tanto nunca se compila
// dentro del bundle público. Se conserva este export vacío solo para no romper
// imports legados que aún lo referencian.
export const ANTHROPIC_API_KEY = ''
