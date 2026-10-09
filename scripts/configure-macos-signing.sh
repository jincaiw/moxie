#!/usr/bin/env bash
set -euo pipefail

credentials=(
  "${MACOS_CERTIFICATE:-}"
  "${MACOS_CERTIFICATE_PASSWORD:-}"
  "${APPLE_ID:-}"
  "${APPLE_APP_SPECIFIC_PASSWORD:-}"
  "${APPLE_TEAM_ID:-}"
)
configured=0
missing=0
for credential in "${credentials[@]}"; do
  if [[ -n "$credential" ]]; then
    configured=$((configured + 1))
  else
    missing=$((missing + 1))
  fi
done

if [[ -z "${GITHUB_ENV:-}" ]]; then
  echo "GITHUB_ENV must point to the GitHub Actions environment file." >&2
  exit 1
fi

if [[ "$configured" -eq 0 ]]; then
  echo "MACOS_SIGNING_ENABLED=false" >> "$GITHUB_ENV"
  echo "macOS signing secrets are not configured; building unsigned packages."
  exit 0
fi

if [[ "$missing" -ne 0 ]]; then
  echo "Configure all five macOS signing secrets or leave all five empty." >&2
  exit 1
fi

{
  echo "CSC_LINK=$MACOS_CERTIFICATE"
  echo "CSC_KEY_PASSWORD=$MACOS_CERTIFICATE_PASSWORD"
  echo "APPLE_ID=$APPLE_ID"
  echo "APPLE_APP_SPECIFIC_PASSWORD=$APPLE_APP_SPECIFIC_PASSWORD"
  echo "APPLE_TEAM_ID=$APPLE_TEAM_ID"
  echo "MACOS_SIGNING_ENABLED=true"
} >> "$GITHUB_ENV"
