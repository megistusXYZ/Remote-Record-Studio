#!/bin/sh
# Daily PostgreSQL dumps into /backups (the db-backups volume), pruned after
# BACKUP_KEEP_DAYS. Runs as the `backup` service in deploy/compose.yaml.
#
# Restore one (stops nothing; run it against a healthy stack):
#   docker compose -f deploy/compose.yaml --env-file deploy/.env \
#     exec -T postgres pg_restore -U vessel -d vessel --clean --if-exists \
#     < ./vessel-20261024T020000Z.dump
# Copy dumps off the host regularly; a backup on the same disk is not a backup.
set -eu

: "${PGHOST:=postgres}"
: "${PGUSER:=vessel}"
: "${PGDATABASE:=vessel}"
: "${BACKUP_KEEP_DAYS:=14}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"
export PGHOST PGUSER PGDATABASE

mkdir -p /backups

while :; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  out="/backups/vessel-${stamp}.dump"
  if pg_dump --format=custom --file="${out}.tmp" && mv "${out}.tmp" "${out}"; then
    echo "backup written: ${out} ($(du -h "${out}" | cut -f1))"
  else
    echo "backup FAILED at ${stamp}" >&2
    rm -f "${out}.tmp"
  fi
  find /backups -name 'vessel-*.dump' -mtime +"${BACKUP_KEEP_DAYS}" -delete
  sleep "${BACKUP_INTERVAL_SECONDS}"
done
