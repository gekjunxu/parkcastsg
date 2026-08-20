#!/usr/bin/env bash

set -euo pipefail

deployment_name="${1:?deployment name is required}"
requested_port="${2:-0}"
deployment_root="${PARKCAST_DEPLOY_ROOT:-$HOME/parkcastsg-deployments}"

slug="$(printf '%s' "$deployment_name" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//' \
  | cut -c1-48)"

if [ -z "$slug" ]; then
  echo "deployment name must contain at least one letter or number" >&2
  exit 2
fi

project="parkcastsg-$slug"
stack_dir="$deployment_root/$slug"
env_file="$stack_dir/.env"

case "$requested_port" in
  ''|0)
    requested_port=0
    ;;
  *[!0-9]*)
    echo "port must be a number between 1024 and 65535" >&2
    exit 2
    ;;
  *)
    if [ "$requested_port" -lt 1024 ] || [ "$requested_port" -gt 65535 ]; then
      echo "port must be a number between 1024 and 65535" >&2
      exit 2
    fi
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required on the deployment host" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required on the deployment host" >&2
  exit 1
fi

mkdir -p "$stack_dir"

if [ "$requested_port" -eq 0 ] && [ -f "$env_file" ]; then
  existing_port="$(sed -n 's/^PARKCAST_PORT=//p' "$env_file" | tail -n 1)"
  case "$existing_port" in
    ''|*[!0-9]*) ;;
    *)
      if [ "$existing_port" -ge 1024 ] && [ "$existing_port" -le 65535 ]; then
        requested_port="$existing_port"
      fi
      ;;
  esac
fi

if [ "$requested_port" -eq 0 ]; then
  hash_hex="$(printf '%s' "$slug" | sha256sum | cut -c1-8)"
  requested_port=$((18000 + (16#$hash_hex % 1000)))

  while docker ps --format '{{.Ports}}' \
      | grep -Eq "(^|, )[0-9.]*:${requested_port}->"; do
    requested_port=$((requested_port + 1))
    if [ "$requested_port" -gt 18999 ]; then
      echo "no free test port is available in 18000-18999" >&2
      exit 1
    fi
  done
fi

if [ -f "$env_file" ]; then
  if grep -q '^PARKCAST_PORT=' "$env_file"; then
    sed -i "s/^PARKCAST_PORT=.*/PARKCAST_PORT=$requested_port/" "$env_file"
  else
    printf '\nPARKCAST_PORT=%s\n' "$requested_port" >> "$env_file"
  fi
else
  printf 'PARKCAST_PORT=%s\nENVIRONMENT=production\n' "$requested_port" > "$env_file"
fi

chmod 600 "$env_file"

cd "$stack_dir"
docker compose --project-name "$project" --env-file "$env_file" up -d --build --remove-orphans

container_id="$(docker compose --project-name "$project" --env-file "$env_file" ps -q parkcastsg)"
if [ -z "$container_id" ]; then
  echo "the ParkCastSG container was not created" >&2
  exit 1
fi

healthy=0
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$status" in
    healthy)
      healthy=1
      break
      ;;
    exited|dead)
      docker compose --project-name "$project" --env-file "$env_file" logs --tail=80 parkcastsg >&2 || true
      exit 1
      ;;
  esac
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  docker compose --project-name "$project" --env-file "$env_file" ps >&2 || true
  docker compose --project-name "$project" --env-file "$env_file" logs --tail=80 parkcastsg >&2 || true
  echo "ParkCastSG did not become healthy within 60 seconds" >&2
  exit 1
fi

printf 'deployment=%s\nproject=%s\nport=%s\nurl=http://%s:%s\n' \
  "$slug" "$project" "$requested_port" "$(hostname)" "$requested_port"
