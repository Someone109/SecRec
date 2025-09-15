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
DNS.2 = redisKeyStore

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


# Create overlay network
docker network inspect redisKeyStore-net >/dev/null 2>&1 || docker network create --driver overlay redisKeyStore-net

# Deploy redisKeyStore services
docker service create --name redisKeyStore \
--replicas 1 \
--network redisKeyStore-net \
--secret redisKeyStore_server.key \
--secret redisKeyStore_server.crt \
--secret redisKeyStore_ca.crt \
redis:7.2 \
redis-server \
--port 0 \
--tls-port 16379 \
--tls-cert-file /run/secrets/redisKeyStore_server.crt \
--tls-key-file /run/secrets/redisKeyStore_server.key \
--tls-ca-cert-file /run/secrets/redisKeyStore_ca.crt \
--tls-auth-clients yes


