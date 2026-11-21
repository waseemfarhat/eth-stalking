#!/usr/bin/env sh
# ETH STALKING — local development launcher (macOS / Linux / Git Bash)
set -e
cd "$(dirname "$0")"
[ -f apps/server/.env ] || { cp apps/server/.env.example apps/server/.env; echo "Created apps/server/.env from example"; }
[ -d node_modules ] || npm install
npm run db:migrate
npm run db:seed
npm run dev
