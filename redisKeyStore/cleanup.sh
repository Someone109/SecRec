#!/bin/bash
set -e

docker service rm redisKeyStore-tls redisKeyStore || true


rm -f ca.key ca.crt ca.srl
rm -f redisKeyStore-server.key redisKeyStore-server.csr redisKeyStore-server.crt
rm -f redisKeyStore-client.key redisKeyStore-client.csr redisKeyStore-client.crt

docker secret rm redisKeyStore_ca.crt redisKeyStore_server.key redisKeyStore_server.crt redisKeyStore_client.key redisKeyStore_client.crt || true
docker network rm redisKeyStore-net || true
docker rmi my-stunnel:1.0 || true


