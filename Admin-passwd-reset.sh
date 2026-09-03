#!/bin/bash
# Admin-passwd-reset.sh - Recovery script for WaWi bootstrap admin
# Resets the password for the pucha.dev admin user
#
# Usage: ./Admin-passwd-reset.sh [new_password]
# If no password is provided, a secure random password is generated.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_ROOT="${SCRIPT_DIR}/stack-root"
PASSWORD_FILE="${STACK_ROOT}/pucha.dev"
ENV_FILE="${SCRIPT_DIR}/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== WaWi Admin Password Reset ===${NC}"
echo ""

# Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}ERROR: .env file not found at ${ENV_FILE}${NC}"
    exit 1
fi

# Source DATABASE_URL from .env
export "$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1)"

if [ -z "${DATABASE_URL:-}" ]; then
    echo -e "${RED}ERROR: DATABASE_URL not set in .env${NC}"
    exit 1
fi

# Generate or use provided password
if [ $# -ge 1 ]; then
    NEW_PASSWORD="$1"
else
    NEW_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9!@#$%^&*' | head -c 32)
    echo -e "${GREEN}Generated new password.${NC}"
fi

echo ""
echo -e "${YELLOW}Target user: puchadev${NC}"
echo ""

# Hash password with argon2id (via the API endpoint or direct psql)
# Using psql directly for recovery scenario
echo "Hashing password..."
PASSWORD_HASH=$(docker run --rm --network host postgres:16-alpine psql "$DATABASE_URL" -tAc "SELECT crypt('${NEW_PASSWORD}', gen_salt('argon2id', 4))" 2>/dev/null || echo "")

if [ -z "$PASSWORD_HASH" ]; then
    echo -e "${RED}ERROR: Could not hash password via PostgreSQL.${NC}"
    echo "Falling back to Node.js argon2..."
    
    # Fallback: use node with argon2 if available
    if command -v node &> /dev/null; then
        HASH_CMD="const argon2 = require('argon2'); argon2.hash(process.argv[1], { type: argon2.argon2id }).then(h => process.stdout.write(h));"
        PASSWORD_HASH=$(node -e "$HASH_CMD" "$NEW_PASSWORD" 2>/dev/null || echo "")
    fi
fi

if [ -z "$PASSWORD_HASH" ]; then
    echo -e "${RED}ERROR: Could not generate password hash.${NC}"
    echo "Please install 'argon2' npm package or ensure PostgreSQL has pgcrypt extension."
    exit 1
fi

echo "Updating database..."
# Update password in database
docker run --rm --network host postgres:16-alpine psql "$DATABASE_URL" -c "
UPDATE users 
SET password_hash = '${PASSWORD_HASH}',
    password_changed_at = NOW(),
    updated_at = NOW()
WHERE username = 'puchadev';
" 2>/dev/null

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Password for 'puchadev' has been reset successfully.${NC}"
    echo ""
    
    # Save to file
    mkdir -p "$STACK_ROOT"
    echo "$NEW_PASSWORD" > "$PASSWORD_FILE"
    chmod 600 "$PASSWORD_FILE"
    
    echo -e "${GREEN}✓ Password saved to: ${PASSWORD_FILE}${NC}"
    echo ""
    echo -e "${YELLOW}New password: ${NEW_PASSWORD}${NC}"
    echo ""
    echo "Please store this password securely and delete the file after memorizing."
    echo "You can now login at http://localhost:5173/login"
else
    echo -e "${RED}ERROR: Database update failed.${NC}"
    exit 1
fi
