# Who Sabi? — Naija trivia with friends

One repository for the game: the Expo app (Android, iOS and web), the backend services and the packages they share. The product and design docs are in [`docs/`](docs/00-README.md); start with the README there.

## Layout

| Path                                         | What it is                                                                                                                                                                               | Status           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`packages/game-rules`](packages/game-rules) | Pure rules shared by every app and service: scoring, answer timing, option shuffling, Glicko-2 ratings, levels, difficulty calibration, WAT dates and streaks, room codes, the duel flow | Built and tested |
| `packages/shared-types`                      | API contracts (Zod)                                                                                                                                                                      | Next             |
| `packages/analytics`                         | Tracking plan and the client event tracker                                                                                                                                               | Next             |
| `apps/api`                                   | Fastify API                                                                                                                                                                              | Next             |
| `apps/ingest`                                | Analytics event intake                                                                                                                                                                   | Next             |
| `apps/app`                                   | Expo app for Android, iOS and the web                                                                                                                                                    | Next             |
| [`docs/`](docs/00-README.md)                 | Product, design and technical docs, schemas and seed questions                                                                                                                           | v1.1             |

The full target layout is in [docs/07 §3](docs/07-system-architecture.md).

## Getting started

You need Node 22 and pnpm 10 (`corepack enable` gives you the pinned pnpm). For the services you also need Postgres 16 and Redis 7; `docker compose up -d` starts them, plus ClickHouse for analytics.

```sh
pnpm install
pnpm test
```

## Checks

CI runs the same commands on every pull request:

```sh
pnpm format:check   # Prettier
pnpm lint           # ESLint, including the rule that keeps native-only modules out of shared app code
pnpm typecheck      # TypeScript in every package
pnpm test           # Vitest in every package
```
