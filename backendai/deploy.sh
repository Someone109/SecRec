#!/bin/bash
set -euo pipefail

DOMAIN="backendai-app"
FRONTEND_CN="frontendRateLimit"
redisNetwork="redisKeyStore-net"
servicesNetwork="services-net"

# Create overlay network
docker network inspect "${servicesNetwork}" >/dev/null 2>&1 || docker network create --driver overlay "${servicesNetwork}"

echo "[1/6] Cleaning up old secrets..."
docker secret rm \
backendai_private.pem backendai_public.pem \
backend_server.key backend_server.crt \
frontend_clients_ca.crt frontend_clients_ca.crt \
frontend_client.key frontend_client.key \
backend_ca.crt backend_ca.crt \
frontend_client.crt frontend_client.crt \
|| true

echo "[2/6] Generating backend app keypair..."
openssl genrsa -out backendai_private.pem 2048
openssl rsa -in backendai_private.pem -pubout -out backendai_public.pem

docker secret create backendai_private.pem backendai_private.pem
docker secret create backendai_public.pem backendai_public.pem

echo "[3/6] Generating backend CA and server certificate..."
# Backend CA
openssl req -x509 -new -newkey rsa:4096 -days 825 -nodes \
-keyout backend_ca.key -out backend_ca.crt \
-subj "/CN=Backend CA/O=YourOrg"

# Server cert CSR config with SAN
cat > server.cnf <<EOF
[req]
distinguished_name = dn
req_extensions = req_ext
prompt = no

[dn]
CN = ${DOMAIN}
O = YourOrg

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${DOMAIN}
EOF

openssl req -new -newkey rsa:2048 -nodes \
-keyout backend_server.key -out backend_server.csr \
-config server.cnf

openssl x509 -req -in backend_server.csr \
-CA backend_ca.crt -CAkey backend_ca.key -CAcreateserial \
-out backend_server.crt -days 825 -sha256 \
-extfile server.cnf -extensions req_ext

docker secret create backend_server.key backend_server.key
docker secret create backend_server.crt backend_server.crt
docker secret create backend_ca.crt backend_ca.crt

echo "[4/6] Generating frontend clients CA and sample client cert..."
# Frontend clients CA
openssl req -x509 -new -newkey rsa:4096 -days 825 -nodes \
-keyout frontend_clients_ca.key -out frontend_clients_ca.crt \
-subj "/CN=Frontend Clients CA/O=YourOrg"

# Sample client cert
cat > client.cnf <<EOF
[req]
distinguished_name = dn
prompt = no

[dn]
CN = ${FRONTEND_CN}
O = YourOrg
EOF

openssl req -new -newkey rsa:2048 -nodes \
-keyout frontend_client.key -out frontend_client.csr \
-config client.cnf

openssl x509 -req -in frontend_client.csr \
-CA frontend_clients_ca.crt -CAkey frontend_clients_ca.key -CAcreateserial \
-out frontend_client.crt -days 825 -sha256

docker secret create frontend_clients_ca.crt frontend_clients_ca.crt

# Mount frontend secrets
docker secret create frontend_client.key frontend_client.key
docker secret create frontend_client.crt frontend_client.crt



echo "[5/6] Building Docker image..."
docker build -t backendai-app .

echo "[6/6] Deploying service with mTLS secrets..."
docker service rm backendai-app || true
docker service create --name backendai-app \
--network "${redisNetwork}" \
--network "${servicesNetwork}" \
--env REDIS_HOST=redisKeyStore \
--env REDIS_PORT=16379 \
--secret redisKeyStore_ca.crt \
--secret redisKeyStore_client.key \
--secret redisKeyStore_client.crt \
--secret backendai_private.pem \
--secret backendai_public.pem \
--secret backend_server.key \
--secret backend_server.crt \
--secret frontend_clients_ca.crt \
backendai-app

echo "Done. Backend service has been deployed!"