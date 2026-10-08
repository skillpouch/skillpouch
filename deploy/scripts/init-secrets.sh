#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Creates the required production secrets in deploy/secrets/ (or $SECRETS_DIR).
# Only missing files are written — an existing secret is NEVER overwritten
# (replacing pepper_key would lock every user out of master-password unlock).
#
#   deploy/scripts/init-secrets.sh
#
# Afterwards copy pepper_key and jwt_signing_key somewhere offline: secrets
# are not part of the backups.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_DIR="${SECRETS_DIR:-$DEPLOY_DIR/secrets}"
CONTAINER_UID=10001 # the `skillpouch` user in deploy/docker/api.Dockerfile

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

random_base64url() {
	openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'
}

ed25519_private_jwk() {
	local script="const { generateKeyPairSync } = require('node:crypto');
const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
const kid = 'k' + new Date().toISOString().slice(0, 10).replaceAll('-', '');
console.log(JSON.stringify({ ...jwk, kid, alg: 'EdDSA', use: 'sig' }));"
	if command -v node >/dev/null 2>&1; then
		node -e "$script"
	else
		docker run --rm node:24-alpine node -e "$script"
	fi
}

create() {
	local name="$1" value="$2" file="$SECRETS_DIR/$1"
	if [[ -s "$file" ]]; then
		echo "keep    $name (already exists)"
		return
	fi
	(umask 077 && printf '%s\n' "$value" >"$file")
	echo "created $name"
}

create better_auth_secret "$(random_base64url 48)"
create dpop_nonce_secret "$(random_base64url 48)"
create ip_hash_secret "$(random_base64url 48)"
create pepper_key "$(random_base64url 32)"
create jwt_signing_key "$(ed25519_private_jwk)"

# The API container runs as uid 10001 and must be able to read the files.
# The docker group (the deploy user) may manage the folder, but not read the
# files: git and the deploy scripts need to work inside it.
if [[ "$(id -u)" == 0 ]]; then
	group=$(getent group docker >/dev/null && echo docker || echo "$CONTAINER_UID")
	chown -R "$CONTAINER_UID:$group" "$SECRETS_DIR"
	chmod 770 "$SECRETS_DIR"
else
	echo "note: run 'sudo chown -R $CONTAINER_UID:$CONTAINER_UID $SECRETS_DIR' so the container can read them"
fi
echo "Back up pepper_key and jwt_signing_key offline — they are not in the backups."
