#!/bin/sh
# Entrypoint of the web image: derive the per-deployment settings, write the
# browser's runtime configuration, then hand over to Caddy.
#
# Required:  VESSEL_DOMAIN        the site, e.g. vessel.example.com
#                                 (a scheme such as http://localhost is allowed
#                                 for local runs and disables HTTPS)
# Optional:  VESSEL_RELAY_DOMAIN  sync server host, default relay.<domain>
#            VESSEL_FILES_DOMAIN  storage server host, default files.<domain>
#            VESSEL_RELAYS        comma-separated sync servers for the client,
#                                 default wss://<relay domain>
#            VESSEL_STORAGE_SERVER default storage server for the client,
#                                 default https://<files domain>
#            VESSEL_MOQ_RELAY_URL optional live preview relay
#            VESSEL_CONTACT_URL   mailto: or https: link for "Contact" in the
#                                 footer, default the project's issue tracker
#            VESSEL_CSP_ENFORCE   "true" sends an enforcing CSP; anything else
#                                 keeps Report-Only
set -eu

: "${VESSEL_DOMAIN:?VESSEL_DOMAIN is required (e.g. vessel.example.com)}"

scheme=""
case "$VESSEL_DOMAIN" in
  *://*) scheme="${VESSEL_DOMAIN%%://*}://" ;;
esac
host="${VESSEL_DOMAIN#*://}"
ws_scheme="wss"
http_scheme="https"
if [ "$scheme" = "http://" ]; then
  ws_scheme="ws"
  http_scheme="http"
fi

: "${VESSEL_RELAY_DOMAIN:=${scheme}relay.${host}}"
: "${VESSEL_FILES_DOMAIN:=${scheme}files.${host}}"
: "${VESSEL_RELAYS:=${ws_scheme}://${VESSEL_RELAY_DOMAIN#*://}}"
: "${VESSEL_STORAGE_SERVER:=${http_scheme}://${VESSEL_FILES_DOMAIN#*://}}"
: "${VESSEL_MOQ_RELAY_URL:=}"
: "${VESSEL_CONTACT_URL:=}"
: "${VESSEL_CSP_ENFORCE:=false}"
: "${ACME_EMAIL:=}"
# Address ranges allowed to set X-Forwarded-For. Default: Cloudflare's egress
# ranges (https://www.cloudflare.com/ips/). Nothing in front? Set a single
# unroutable address such as 192.0.2.1/32.
: "${TRUSTED_PROXY_RANGES:=173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32}"

if [ "$VESSEL_CSP_ENFORCE" = "true" ]; then
  VESSEL_CSP_HEADER="Content-Security-Policy"
else
  VESSEL_CSP_HEADER="Content-Security-Policy-Report-Only"
fi
export VESSEL_DOMAIN VESSEL_RELAY_DOMAIN VESSEL_FILES_DOMAIN VESSEL_CSP_HEADER ACME_EMAIL TRUSTED_PROXY_RANGES

json_str() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

relays_json="["
first=1
old_ifs="$IFS"
IFS=','
for r in $VESSEL_RELAYS; do
  r="$(printf '%s' "$r" | tr -d '[:space:]')"
  [ -n "$r" ] || continue
  if [ "$first" = 1 ]; then first=0; else relays_json="${relays_json},"; fi
  relays_json="${relays_json}\"$(json_str "$r")\""
done
IFS="$old_ifs"
relays_json="${relays_json}]"

cat > /srv/config.js <<CONFIG
// Written at container start from the deployment environment. Nothing here is secret.
window.__VESSEL_CONFIG__ = {"relays":${relays_json},"storageServer":"$(json_str "$VESSEL_STORAGE_SERVER")","moqRelayUrl":"$(json_str "$VESSEL_MOQ_RELAY_URL")","contactUrl":"$(json_str "$VESSEL_CONTACT_URL")"};
CONFIG

echo "vessel-web: site=${VESSEL_DOMAIN} relay=${VESSEL_RELAY_DOMAIN} files=${VESSEL_FILES_DOMAIN} csp=${VESSEL_CSP_HEADER}"
exec "$@"
