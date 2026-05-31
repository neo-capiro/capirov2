// Dev-safe runtime config placeholder.
//
// In ECS/nginx deployments, the container entrypoint overwrites this file
// with window.__CAPIRO_CONFIG__ at boot.
//
// In local Vite dev, serving a valid JS file here prevents /runtime-config.js
// from falling through to index.html (HTML-as-JS parse error) before app boot.
