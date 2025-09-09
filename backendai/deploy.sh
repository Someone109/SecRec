#!/bin/bash
set -e

# Generate a 2048-bit RSA private key
openssl genrsa -out backendai_private.pem 2048

# Extract the public key
openssl rsa -in backendai_private.pem -pubout -out backendai_public.pem

#Remove past secrets if they exist
docker secret rm backendai_private.pem backendai_public.pem || true

# Create Docker secrets
docker secret create backendai_private.pem backendai_private.pem
docker secret create backendai_public.pem backendai_public.pem


# Build the Docker image
docker build -t backendai-app .

# Run the Docker container
docker service create --name backendai-app \
  --network redisKeyStore-outerNet \
  --env REDIS_HOST=redisKeyStore-tls \
  --env REDIS_PORT=16379 \
  --secret redisKeyStore_ca.crt \
  --secret redisKeyStore_client.key \
  --secret redisKeyStore_client.crt \
  --secret backendai_private.pem \
  --secret backendai_public.pem \
  --publish 3000:3000 \
  backendai-app
