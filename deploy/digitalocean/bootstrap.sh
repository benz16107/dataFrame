#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as a non-root user with sudo access."
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script is intended for Ubuntu/Debian Linux servers."
  exit 1
fi

if [[ ! -f "/etc/os-release" ]]; then
  echo "Cannot detect OS."
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"debian"* ]]; then
  echo "Detected ${ID:-unknown}; continuing, but package steps are tuned for Ubuntu/Debian."
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing Docker Engine + Compose plugin"
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
fi
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  echo "Added $USER to docker group. Log out and back in after this run."
fi

echo "==> Preparing deployment environment"
cd "$SCRIPT_DIR"

if [[ ! -f .env.backend ]]; then
  cp .env.backend.example .env.backend
  echo "Created .env.backend from template. Fill required values before first deploy."
  echo "Required: SESSION_SECRET, AUTH0_*, APP_HOST, APP_BASE_URL, FRONTEND_BASE_URL, GEMINI_API_KEY"
fi

if grep -q "replace-with-a-long-random-secret" .env.backend; then
  echo "WARNING: .env.backend still contains placeholder values."
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found in current shell yet. Re-login and run:"
  echo "  cd $SCRIPT_DIR && docker compose up -d --build"
  exit 0
fi

echo "==> Building and starting services"
docker compose up -d --build

echo "==> Done"
echo "Check status: docker compose ps"
echo "Logs: docker compose logs -f caddy"
