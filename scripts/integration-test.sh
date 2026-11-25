#!/bin/sh
set -eu

SCRIPT_DIR=$(dirname "$0")
cd "$SCRIPT_DIR/.."
PROJECT_ROOT=$PWD
PROJECT_NAME="orca-publisher-it-$$"
MQTT_TEST_PORT=$((20000 + $$ % 40000))
export MQTT_TEST_PORT
export MQTT_INTEGRATION_URL="tcp://127.0.0.1:$MQTT_TEST_PORT"

cleanup() {
  docker compose --file "$PROJECT_ROOT/docker-compose.yml" --project-name "$PROJECT_NAME" down --volumes --remove-orphans
}
trap cleanup EXIT

docker compose --file "$PROJECT_ROOT/docker-compose.yml" --project-name "$PROJECT_NAME" up --detach --wait
npm test -- test/mqtt/integration.test.ts
