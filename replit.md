# AJKMart Super-App Monorepo

## Overview

AJKMart is a multi-service super-app platform designed for the AJK region of Pakistan. It integrates e-commerce, food delivery, ride-hailing, pharmacy services, parcel delivery, and inter-city transport into a single platform. The project aims to provide a robust, low-resource-friendly experience optimized for environments with slow networks and budget devices. The system comprises four user-facing applications (customer mobile/web, rider PWA, vendor portal, admin panel) supported by a Node.js API server and PostgreSQL database.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure

The project is structured as a pnpm workspace monorepo, enforcing pnpm usage. It includes shared libraries for database schema, API client, validation, internationalization, integrations, phone utilities, and shared admin timing utilities, consumed by various deployable applications such as the API server, admin panel, rider app, vendor app, and customer super-app. TypeScript project references are used for efficient type-checking and build processes.

### Applications

1.  **api-server**: A Node.js/Express backend providing a unified API for all clients. It uses Drizzle ORM for database interactions, Zod for validation, and Socket.IO for real-time features.
2.  **admin**: A React + Vite application serving as the central administration panel, featuring a "Command Center" design with various modules for operations, inventory, finance, safety, and configuration.
3.  **rider-app**: A React + Vite PWA for riders, including mapping, GPS tracking, order/ride management, and financial features.
4.  **vendor-app**: A React + Vite application for vendors to manage products, inventory, and orders.
5.  **ajkmart**: An Expo / React Native customer super-app, supporting mobile and web builds, with features like biometrics, deep linking for authentication, and network-aware image loading.

### Backend Architecture

The backend leverages Express with Zod validation, JWT-based authentication, CSRF protection, rate limiting, and structured logging. Socket.IO facilitates real-time events. A multi-method authentication system supports Phone/Email OTP, Username/Password, OAuth, magic links, and TOTP 2FA, with methods togglable via platform configuration. It also uses Redis-backed rate limiting, Firebase admin services, Twilio, Nodemailer, web push, QR code generation, image processing, and AI integrations where needed. A hybrid wallet model manages commissions and rider balances, with atomic transactions for critical operations. A central platform configuration endpoint allows dynamic control over features, pricing, and service settings.

### Frontend Architecture

The customer app uses Expo, supporting lazy-loaded service modules that are toggled via feature flags in platform config. React Query is used for server state management with AsyncStorage persistence for offline resilience. The project supports trilingual internationalization (English/Urdu/Roman Urdu) via a shared library. A consistent design system is applied across applications, utilizing Lucide icons for web and Ionicons for Expo, with specific color palettes per application.

### Data Layer

PostgreSQL is the chosen database, with schema managed by Drizzle ORM. Drizzle Kit is used for migrations. The schema is organized by domain, covering users, orders, products, rides, wallets, platform settings, permissions, and integration-related data.

### Key Architectural Decisions

-   **Single API Server**: Chosen for simplicity, cost efficiency, and easier transaction consistency, suitable for the target regional scale.
-   **pnpm Workspace**: Preferred over more complex monorepo tools for its simplicity and sufficiency for project needs.
-   **Expo for Customer App**: Enables a single codebase for iOS/Android/Web, balancing native capabilities with web compatibility.
-   **Admin-Driven Configuration**: Most business logic and feature toggles are controllable via the admin panel, reducing the need for code redeploys.
-   **Manual Payment Verification**: Aligns with local payment habits and avoids initial gateway fees by supporting bank transfers with admin verification.

## Development Setup

> Full setup guide: see `setup.md` in the project root.

### Prerequisites
This is a pnpm workspace monorepo. All dependencies must be installed from the workspace root before starting any artifact.

```bash
pnpm install
```

### Workflows & Ports (Replit)
All services are managed as separate Replit workflows. The API server proxies frontend apps through its dev proxy middleware.

| Workflow name | Preview path | Port |
|---|---|---|
| `Start application` | `/` (hub), `/api` | 5000 |
| `artifacts/admin: web` | `/admin/` | 23744 |
| `Rider App` | `/rider/` | 3001 |
| `Vendor App` | `/vendor/` | 3002 |

The API server at port 5000 proxies `/admin/` (→23744), `/rider/` (→3001), `/vendor/` (→3002) to the respective frontend Vite servers. All apps load correctly through the single port 5000 preview.

### Shared Libraries
The monorepo contains shared libraries under `lib/` that are consumed by the artifacts via workspace `*` references:
- `@workspace/db` — Drizzle ORM schema and migration utilities
- `@workspace/api-client-react` — typed API client with React Query hooks
- `@workspace/api-spec` / `@workspace/api-zod` — Zod-validated API contracts
- `@workspace/i18n` — trilingual string catalogue (English / Urdu / Roman Urdu)
- `@workspace/service-constants` — shared enums, IDs, and feature flags
- `@workspace/auth-utils` — JWT helpers shared between server and clients
- `@workspace/admin-timing-shared` — time-slot utilities for the admin panel
- `@workspace/phone-utils` — phone number utilities and helpers
- `@workspace/integrations` — shared integration helpers and adapters
- `@workspace/integrations-gemini-ai` — Gemini AI integration utilities

### Environment Variables

All credentials and secrets are managed via **Replit Secrets** (the padlock icon in the sidebar) and `[userenv.shared]` in `.replit`. There is no encrypted `.env.enc` file or `env-manager` — secrets flow directly from Replit's secrets store into the process environment.

**Required secrets — add these in the Replit Secrets panel:**
- `DATABASE_URL` — PostgreSQL connection string (required)
- `JWT_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_REFRESH_SECRET`, `ADMIN_SECRET` — JWT signing keys
- `ADMIN_ACCESS_TOKEN_SECRET`, `ADMIN_REFRESH_TOKEN_SECRET`, `ADMIN_CSRF_SECRET` — Admin auth
- `VENDOR_JWT_SECRET`, `RIDER_JWT_SECRET` — App-specific JWT keys
- `ERROR_REPORT_HMAC_SECRET` — HMAC signing for error reports

**Optional API keys — add in Replit Secrets when needed:**
- `GEMINI_API_KEY` — Gemini AI features
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — Push notifications
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — SMS OTP
- `SENDGRID_API_KEY` — Email delivery
- `GOOGLE_MAPS_API_KEY` — Maps features
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` — Web push
- `REDIS_URL` — Redis for rate-limiting
- `SENTRY_DSN` — Error tracking

**API server first-run check:** `artifacts/api-server/src/index.ts` runs `checkEnv()` on boot — shows a banner with exact fix commands if `DATABASE_URL` or `JWT_SECRET` are missing. Fatal in production, warning in development.

**Frontend dev warnings:** Admin, Vendor, and Rider apps log a `console.group` warning in dev mode if `VITE_API_PROXY_TARGET` is not set.

**Required variables (50 total):**
| Category | Variables |
|---|---|
| Database | `DATABASE_URL` |
| JWT / Auth | `JWT_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_REFRESH_SECRET`, `ADMIN_SECRET`, `ADMIN_ACCESS_TOKEN_SECRET`, `ADMIN_REFRESH_TOKEN_SECRET`, `ADMIN_CSRF_SECRET`, `VENDOR_JWT_SECRET`, `RIDER_JWT_SECRET`, `JWT_ISSUER` |
| Admin Seed | `ADMIN_SEED_USERNAME`, `ADMIN_SEED_PASSWORD`, `ADMIN_SEED_EMAIL`, `ADMIN_SEED_NAME` |
| Security | `ERROR_REPORT_HMAC_SECRET`, `ALLOWED_ORIGINS`, `ADMIN_LEGACY_AUTH_DISABLED`, `ADMIN_PASSWORD_RESET_TOKEN_TTL_MIN` |
| Ports & URLs | `PORT` (5000), `APP_BASE_URL`, `ADMIN_BASE_URL`, `FRONTEND_URL`, `CLIENT_URL`, `PORT_FALLBACK_ENABLE`, `PORT_MAX_RETRIES` |
| Firebase | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| Twilio / SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Email | `SENDGRID_API_KEY`, `SMTP_HOST` |
| AI | `GEMINI_API_KEY` |
| Maps | `GOOGLE_MAPS_API_KEY`, `OSRM_API_URL` |
| Push (VAPID) | `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_CONTACT_EMAIL` |
| Infrastructure | `REDIS_URL`, `SENTRY_DSN` |
| Runtime | `NODE_ENV`, `LOG_LEVEL` |
| Expo / Vite | `EXPO_PUBLIC_DOMAIN`, `VITE_API_BASE_URL`, `VITE_API_PROXY_TARGET` |

### Validation and Support Scripts
The API server includes a `check-permissions` validation script used by the Replit workflow, and the monorepo includes launcher scripts for Replit, Codespaces, VPS, and local development.

## External Dependencies

### Core Runtime & Frameworks
-   **Node.js**, **Express**, **Socket.IO**, **Drizzle ORM**, **Zod** (API server).
-   **PostgreSQL** (database).
-   **React 19**, **Vite** (admin/rider/vendor web apps).
-   **Wouter**, **React Router**, **Expo Router** (routing).
-   **Expo SDK** (with `expo-secure-store`, `expo-local-authentication`, `expo-image`, `expo-auth-session`, `expo-camera`, `expo-store-review`, `expo-linking`).
-   **EAS CLI** (for native builds).

### Authentication & Security
-   **@react-oauth/google** (Google sign-in).
-   **Facebook SDK**.
-   **JWT**, **bcrypt**, **TOTP** (2FA), **reCAPTCHA v3**.

### Maps & Location
-   **Leaflet** (web maps).
-   **NetInfo** (network quality detection).

### Real-time & State
-   **Socket.IO** (real-time communication).
-   **TanStack React Query** (server state management with offline persistence).

### Payment & Wallet
-   Integration with **JazzCash**, **EasyPaisa**, **Bank Transfer** (manual verification).

### Notifications
-   **Expo push tokens** (mobile push notifications).
-   **SMS / WhatsApp / Email OTP** (provider abstracted).

### Tooling
-   **TypeScript 5.9**, **Prettier 3.8**.
-   **pnpm**.
-   **Drizzle Kit** (migrations).
-   **Sentry** (error reporting).
