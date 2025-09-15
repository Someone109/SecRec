#!/bin/bash
set -e

# CA Generation
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
-subj "/CN=redisRateLimit-ca" -out ca.crt

# Create OpenSSL config for SAN (Subject Alternative Name)
cat > openssl-san.cnf <<EOF
[ req ]
default_bits       = 4096
distinguished_name = req_distinguished_name
req_extensions     = req_ext
prompt             = no

[ req_distinguished_name ]
CN = redisRateLimit-server

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = localhost
IP.1 = 127.0.0.1
DNS.2 = redisRateLimit

EOF


# Server key + CSR + signed cert
openssl genrsa -out redisRateLimit-server.key 4096
openssl req -new -key redisRateLimit-server.key -out redisRateLimit-server.csr -config openssl-san.cnf
openssl x509 -req -in redisRateLimit-server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
-out redisRateLimit-server.crt -days 3650 -sha256 -extensions req_ext -extfile openssl-san.cnf

rm -f openssl-san.cnf

# Client key + CSR + signed cert
openssl genrsa -out redisRateLimit-client.key 4096
openssl req -new -key redisRateLimit-client.key -subj "/CN=redisRateLimit-client" -out redisRateLimit-client.csr
openssl x509 -req -in redisRateLimit-client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
-out redisRateLimit-client.crt -days 3650 -sha256

# Remove older Docker Secrets if they exist
docker secret rm redisRateLimit_ca.crt redisRateLimit_server.key redisRateLimit_server.crt redisRateLimit_client.key redisRateLimit_client.crt || true

# Create Docker secrets
docker secret create redisRateLimit_ca.crt ca.crt
docker secret create redisRateLimit_server.key redisRateLimit-server.key
docker secret create redisRateLimit_server.crt redisRateLimit-server.crt
docker secret create redisRateLimit_client.key redisRateLimit-client.key
docker secret create redisRateLimit_client.crt redisRateLimit-client.crt


# Create overlay network
docker network inspect redisRateLimit-net >/dev/null 2>&1 || docker network create --driver overlay redisRateLimit-net

# Deploy redisRateLimit services
docker service create --name redisRateLimit \
--replicas 1 \
--network redisRateLimit-net \
--secret redisRateLimit_server.key \
--secret redisRateLimit_server.crt \
--secret redisRateLimit_ca.crt \
redis:7.2 \
redis-server \
--port 0 \
--tls-port 16379 \
--tls-cert-file /run/secrets/redisRateLimit_server.crt \
--tls-key-file /run/secrets/redisRateLimit_server.key \
--tls-ca-cert-file /run/secrets/redisRateLimit_ca.crt \
--tls-auth-clients yes


