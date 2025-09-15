#!/bin/bash
set -euo pipefail

servicesNetwork="services-net"

# Ensure overlay network exists
docker network inspect "${servicesNetwork}" >/dev/null 2>&1 || \
docker network create --driver overlay "${servicesNetwork}"

# Ensure required secrets exist
for s in frontend_client.key frontend_client.crt backend_ca.crt; do
    docker secret inspect "$s" >/dev/null 2>&1 || {
        echo "Error: Missing secret '$s'. Create it before deploying." >&2
        exit 1
    }
done

echo "[1/3] Building frontend image..."
docker build -t frontendratelimit-app .

echo "[2/3] Removing old service (if exists)..."
docker service rm frontendRateLimit >/dev/null 2>&1 || true

echo "[3/3] Deploying frontend service with mTLS client cert..."
docker service create --name frontendRateLimit \
--network "${servicesNetwork}" \
--network redisRateLimit-net \
--env BACKEND_HOST=backendai-app \
--env BACKEND_PORT=3000 \
--secret frontend_client.key \
--secret frontend_client.crt \
--secret backend_ca.crt \
--secret redisRateLimit_ca.crt \
--secret redisRateLimit_client.key \
--secret redisRateLimit_client.crt \
--publish 8080:8080 \
frontendratelimit-app

echo "Done. Frontend service has been deployed!"
