#!/usr/bin/env bash
# Starts coturn (when a TURN host is known), Caddy (when DOMAIN is set) and the Node server, and stops all of them
# as soon as one exits so the container's restart policy can bring the set back up.
set -euo pipefail

export DATA_DIR="${DATA_DIR:-/data}"
export PORT="${PORT:-8080}"
runtime="$(mktemp -d)"
mkdir -p "$DATA_DIR/secrets"
chmod 700 "$DATA_DIR/secrets"

# Secrets that are not passed in are generated once and kept in the data volume.
for name in ROOM_TURN_SECRET TURN_AUTH_SECRET RATE_LIMIT_SECRET UPLOAD_PASS_SECRET; do
  if [ -z "${!name:-}" ]; then
    file="$DATA_DIR/secrets/$name"
    if [ ! -s "$file" ]; then
      (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$file")
    fi
    export "$name=$(cat "$file")"
  fi
done

if [ -n "${DOMAIN:-}" ]; then
  export PUBLIC_URL="${PUBLIC_URL:-https://$DOMAIN}"
  export TRUST_PROXY="${TRUST_PROXY:-1}"
  export HOST="${HOST:-127.0.0.1}"
fi

public_host="${DOMAIN:-}"
if [ -z "$public_host" ] && [ -n "${PUBLIC_URL:-}" ]; then
  public_host="$(printf '%s' "$PUBLIC_URL" | sed -E 's#^[a-zA-Z]+://##; s#[/?].*$##; s#:[0-9]+$##')"
fi

pids=()
signalled=false
stop() { kill -TERM "${pids[@]}" 2>/dev/null || true; }
trap 'signalled=true; stop' TERM INT

turn_host="${TURN_HOST:-$public_host}"
if [ "${TURN_ENABLED:-auto}" != "false" ] && [ -n "$turn_host" ]; then
  export TURN_PROVIDER="${TURN_PROVIDER:-coturn}"
  export TURN_HOST="$turn_host"
  turn_port="${TURN_PORT:-3478}"
  {
    echo "listening-port=$turn_port"
    echo "realm=${TURN_REALM:-$turn_host}"
    echo "use-auth-secret"
    echo "static-auth-secret=$TURN_AUTH_SECRET"
    echo "min-port=${TURN_MIN_PORT:-49152}"
    echo "max-port=${TURN_MAX_PORT:-49251}"
    [ -n "${TURN_EXTERNAL_IP:-}" ] && echo "external-ip=$TURN_EXTERNAL_IP"
    echo "user-quota=${TURN_USER_QUOTA:-12}"
    echo "total-quota=${TURN_TOTAL_QUOTA:-1200}"
    echo "max-bps=${TURN_MAX_BPS:-625000}"
    echo "stale-nonce=600"
    echo "fingerprint"
    echo "no-cli"
    echo "no-tls"
    echo "no-dtls"
    echo "no-multicast-peers"
    echo "no-software-attribute"
    echo "simple-log"
    echo "pidfile=$runtime/turnserver.pid"
    echo "userdb=$runtime/turndb"
    if [ "${TURN_LOG:-false}" = "true" ]; then echo "log-file=stdout"; else echo "no-stdout-log"; echo "log-file=/dev/null"; fi
    # Relays must never reach this host's loopback, the Docker network or other private and reserved ranges.
    for range in 0.0.0.0-0.255.255.255 10.0.0.0-10.255.255.255 100.64.0.0-100.127.255.255 127.0.0.0-127.255.255.255 \
      169.254.0.0-169.254.255.255 172.16.0.0-172.31.255.255 192.0.0.0-192.0.0.255 192.0.2.0-192.0.2.255 \
      192.88.99.0-192.88.99.255 192.168.0.0-192.168.255.255 198.18.0.0-198.19.255.255 198.51.100.0-198.51.100.255 \
      203.0.113.0-203.0.113.255 240.0.0.0-255.255.255.255 ::1 64:ff9b::-64:ff9b::ffff:ffff \
      ::ffff:0.0.0.0-::ffff:255.255.255.255 100::-100::ffff:ffff:ffff:ffff 2001::-2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff \
      2002::-2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
      fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff; do
      echo "denied-peer-ip=$range"
    done
  } > "$runtime/turnserver.conf"
  turnserver -c "$runtime/turnserver.conf" &
  pids+=($!)
  echo "TURN relay on $turn_host:$turn_port (UDP and TCP), relay ports ${TURN_MIN_PORT:-49152}-${TURN_MAX_PORT:-49251}/udp"
elif [ "${TURN_ENABLED:-auto}" != "false" ]; then
  echo "TURN relay off: set DOMAIN, PUBLIC_URL or TURN_HOST so browsers can reach it"
fi

if [ -n "${DOMAIN:-}" ]; then
  {
    printf '{\n\tadmin off\n\tstorage file_system %s\n' "$DATA_DIR/caddy"
    [ -n "${ACME_EMAIL:-}" ] && printf '\temail %s\n' "$ACME_EMAIL"
    printf '}\n\n%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"
  } > "$runtime/Caddyfile"
  XDG_CONFIG_HOME="$runtime" caddy run --config "$runtime/Caddyfile" --adapter caddyfile &
  pids+=($!)
fi

node /app/dist/node/server.mjs &
pids+=($!)

status=0
wait -n "${pids[@]}" || status=$?
stop
wait "${pids[@]}" 2>/dev/null || true
if [ "$signalled" = true ]; then exit 0; fi
exit $(( status == 0 ? 1 : status ))
