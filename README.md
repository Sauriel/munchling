# Munchling

Lokaler Kalorien- und Nährwerttracker als mobile Hybrid-App mit Nuxt 4, Vue 3 und Capacitor.

## Setup

```bash
pnpm install
pnpm dev
```

## Mobile / Capacitor

```bash
pnpm generate
pnpm cap:add:android
pnpm cap:add:ios
pnpm cap:sync
```

Die Capacitor-Ausgabe nutzt `.output/public` als Web-Verzeichnis.
