#!/usr/bin/env bash
# Bot X-Ray server setup (Ubuntu). Safe to run again: every step checks first.
#   sudo bash setup.sh            install / update, enable the service (doesn't start it)
#   sudo bash setup.sh --start    …and (re)start it
# It creates the user xray (no sudo), installs nvm + Node 24 for that user only, clones the mm-v2 branch to
# /home/xray/bot-x-ray and installs the systemd unit. It does not touch nginx, the firewall, other users or
# other services.
set -euo pipefail

REPO="https://github.com/MalikovAzizjon4843/bot-x-ray.git"
BRANCH="mm-v2"
APP_USER="xray"
HOME_DIR="/home/${APP_USER}"
APP_DIR="${HOME_DIR}/bot-x-ray"
NVM_VERSION="v0.40.1"
NODE_MAJOR="24"
UNIT="/etc/systemd/system/bot-x-ray.service"
START=0
[[ "${1:-}" == "--start" ]] && START=1

say() { printf '\n== %s\n' "$*"; }
as_app() { sudo -u "${APP_USER}" -H bash -lc "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0 [--start]" >&2
  exit 1
fi

say "packages (git, curl, ca-certificates)"
missing=()
for p in git curl ca-certificates; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if ((${#missing[@]})); then
  apt-get update -qq
  apt-get install -y -qq "${missing[@]}"
else
  echo "already installed"
fi

say "user ${APP_USER}"
if id "${APP_USER}" >/dev/null 2>&1; then
  echo "exists"
else
  useradd --create-home --shell /bin/bash "${APP_USER}"
  echo "created (no sudo rights)"
fi

say "nvm ${NVM_VERSION} + Node ${NODE_MAJOR} for ${APP_USER}"
if [[ ! -s "${HOME_DIR}/.nvm/nvm.sh" ]]; then
  as_app "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash"
fi
as_app "source ~/.nvm/nvm.sh && nvm install ${NODE_MAJOR} >/dev/null && nvm alias default ${NODE_MAJOR} >/dev/null"
# a fixed path for systemd, whatever the exact Node version is
as_app "mkdir -p ~/bin && ln -sfn \"\$(source ~/.nvm/nvm.sh && nvm which ${NODE_MAJOR})\" ~/bin/node && ~/bin/node --version"

say "code: ${APP_DIR} (${BRANCH})"
if [[ -d "${APP_DIR}/.git" ]]; then
  as_app "cd '${APP_DIR}' && git fetch -q origin && git checkout -q '${BRANCH}' && git pull -q --ff-only origin '${BRANCH}' && git log --oneline -1"
else
  as_app "git clone -q -b '${BRANCH}' '${REPO}' '${APP_DIR}' && cd '${APP_DIR}' && git log --oneline -1"
fi
# no dependencies today; if a lockfile ever appears, install exactly what it says
if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  as_app "cd '${APP_DIR}' && PATH=\$HOME/bin:\$PATH npm ci --omit=dev"
else
  echo "no package-lock.json: nothing to install (the app has no dependencies)"
fi

say "systemd unit"
if [[ -f "${UNIT}" ]] && cmp -s "${APP_DIR}/deploy/bot-x-ray.service" "${UNIT}"; then
  echo "unchanged"
else
  install -m 0644 "${APP_DIR}/deploy/bot-x-ray.service" "${UNIT}"
  systemctl daemon-reload
  echo "installed ${UNIT}"
fi
systemctl enable bot-x-ray >/dev/null 2>&1 && echo "enabled (starts on boot)"

if ((START)); then
  say "start"
  systemctl restart bot-x-ray
  sleep 3
  systemctl --no-pager --lines=5 status bot-x-ray || true
  curl -fsS -m 5 http://127.0.0.1:3797/api/health && echo
else
  say "not started. Start it with: sudo systemctl start bot-x-ray"
fi
