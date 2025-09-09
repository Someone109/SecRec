#!/bin/sh
set -e

mkdir -p /etc/stunnel

cat /run/secrets/redisKeyStore_server.key /run/secrets/redisKeyStore_server.crt > /etc/stunnel/redisKeyStore.pem

cat > /etc/stunnel/stunnel.conf <<EOF
foreground = yes
options = NO_SSLv2
options = NO_SSLv3
options = NO_TLSv1
client = no

[redisKeyStore-tls]
client = no
accept = ${STUNNEL_ACCEPT:-16379}
connect = ${STUNNEL_CONNECT:-redisKeyStore:6379}
cert = /etc/stunnel/redisKeyStore.pem
key = /etc/stunnel/redisKeyStore.pem
CAfile = /run/secrets/redisKeyStore_ca.crt
verifyChain = yes
verify = ${STUNNEL_VERIFY:-2}
TIMEOUTclose = 0
delay = yes
EOF

exec stunnel /etc/stunnel/stunnel.conf
