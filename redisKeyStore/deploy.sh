#!/bin/bash
set -e

# CA Generation
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
-subj "/CN=redisKeyStore-ca" -out ca.crt

# Create OpenSSL config for SAN (Subject Alternative Name)
cat > openssl-san.cnf <<EOF
[ req ]
default_bits       = 4096
distinguished_name = req_distinguished_name
req_extensions     = req_ext
prompt             = no

[ req_distinguished_name ]
CN = redisKeyStore-server

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = localhost
IP.1 = 127.0.0.1
DNS.2 = redisKeyStore-tls

EOF


# Server key + CSR + signed cert
openssl genrsa -out redisKeyStore-server.key 4096
openssl req -new -key redisKeyStore-server.key -out redisKeyStore-server.csr -config openssl-san.cnf
openssl x509 -req -in redisKeyStore-server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
-out redisKeyStore-server.crt -days 3650 -sha256 -extensions req_ext -extfile openssl-san.cnf

rm -f openssl-san.cnf

# Client key + CSR + signed cert
openssl genrsa -out redisKeyStore-client.key 4096
openssl req -new -key redisKeyStore-client.key -subj "/CN=redisKeyStore-client" -out redisKeyStore-client.csr
openssl x509 -req -in redisKeyStore-client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
-out redisKeyStore-client.crt -days 3650 -sha256

# Remove older Docker Secrets if they exist
docker secret rm redisKeyStore_ca.crt redisKeyStore_server.key redisKeyStore_server.crt redisKeyStore_client.key redisKeyStore_client.crt || true

# Create Docker secrets
docker secret create redisKeyStore_ca.crt ca.crt
docker secret create redisKeyStore_server.key redisKeyStore-server.key
docker secret create redisKeyStore_server.crt redisKeyStore-server.crt
docker secret create redisKeyStore_client.key redisKeyStore-client.key
docker secret create redisKeyStore_client.crt redisKeyStore-client.crt

# Build stunnel image
docker build -t my-stunnel:1.0 ./stunnel

# Create overlay network
docker network inspect redisKeyStore-net >/dev/null 2>&1 || docker network create --driver overlay redisKeyStore-net
docker network inspect redisKeyStore-outerNet >/dev/null 2>&1 || docker network create --driver overlay redisKeyStore-outerNet


# Deploy redisKeyStore and stunnel services
docker service create --name redisKeyStore \
--replicas 1 \
--network redisKeyStore-net \
redis:7.2

# Deploy stunnel service with secrets and publish port
docker service create --name redisKeyStore-tls \
--replicas 1 \
--network redisKeyStore-net \
--secret redisKeyStore_server.key \
--secret redisKeyStore_server.crt \
--secret redisKeyStore_ca.crt \
--secret redisKeyStore_client.key \
--secret redisKeyStore_client.crt \
--network redisKeyStore-outerNet \
my-stunnel:1.0



# Example: Deploy your backend service to the same overlay network as stunnel
# and set the correct Redis host/port environment variables
#
# docker service create --name backendai-app \
#   --network redisKeyStore-outerNet \
#   --env REDIS_HOST=redisKeyStore-tls \
#   --env REDIS_PORT=16379 \
#   --secret redisKeyStore_ca.crt \
#   --secret redisKeyStore_client.key \
#   --secret redisKeyStore_client.crt \
#   <other options> \
#   <your-backend-image>

# Now your backend can connect to Redis via stunnel using:
#   host: redisKeyStore-tls
#   port: 16379

