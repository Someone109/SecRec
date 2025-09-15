#!/bin/bash
set -e

docker service rm redisRateLimit || true


rm -f ca.key ca.crt ca.srl
rm -f redisRateLimit-server.key redisRateLimit-server.csr redisRateLimit-server.crt
rm -f redisRateLimit-client.key redisRateLimit-client.csr redisRateLimit-client.crt

docker secret rm redisRateLimit_ca.crt redisRateLimit_server.key redisRateLimit_server.crt redisRateLimit_client.key redisRateLimit_client.crt || true
docker network rm redisRateLimit-net || true


