#!/bin/bash
set -e

cd /Users/hunter/Documents/GitHub/orchestra

# Install all workspace dependencies (idempotent)
bun install

# Ensure mobile app has Jest config (idempotent)
if [ -d "apps/mobile" ] && [ ! -f "apps/mobile/jest.config.js" ]; then
  echo "Note: apps/mobile jest config will be created by scaffold feature"
fi

echo "Init complete"
