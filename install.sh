#!/usr/bin/env bash
# Oserus Management — installer (macOS / Linux)
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

if [ -t 1 ]; then
  C_BOLD="\033[1m"; C_DIM="\033[2m"; C_RED="\033[31m"; C_GRN="\033[32m"; C_YEL="\033[33m"; C_CYA="\033[36m"; C_RST="\033[0m"
else C_BOLD=""; C_DIM=""; C_RED=""; C_GRN=""; C_YEL=""; C_CYA=""; C_RST=""; fi

printf "\n${C_BOLD}Oserus Management — installer${C_RST}\n\n"

if ! command -v node >/dev/null 2>&1; then
  printf "${C_RED}✗ Node.js is not installed.${C_RST}\n  Install from ${C_CYA}https://nodejs.org${C_RST} (LTS), then re-run.\n\n"; exit 1
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  printf "${C_RED}✗ Node.js v$NODE_VER is too old. Need v20+.${C_RST}\n  Get the LTS from ${C_CYA}https://nodejs.org${C_RST}\n\n"; exit 1
fi
printf "${C_GRN}✓${C_RST} Node $(node -v) detected\n\n"

printf "${C_BOLD}Installing dependencies + rebuilding native modules…${C_RST}\n"
printf "${C_DIM}(this can take 1-3 minutes on first run)${C_RST}\n"
npm install --no-audit --no-fund

OS=$(uname)
if [ "$OS" = "Darwin" ]; then DATA_DIR="$HOME/Library/Application Support/reddit-manager"
else DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/reddit-manager"; fi

printf "\n${C_GRN}${C_BOLD}✓ Install complete.${C_RST}\n\n"
printf "${C_BOLD}Locations:${C_RST}\n  1. ${C_CYA}$SCRIPT_DIR${C_RST} ${C_DIM}(code)${C_RST}\n  2. ${C_CYA}$DATA_DIR${C_RST} ${C_DIM}(created on first launch — database, sessions)${C_RST}\n\n"
printf "${C_BOLD}To run:${C_RST} ${C_YEL}npm run dev${C_RST}\n"
printf "${C_BOLD}To uninstall:${C_RST} ${C_YEL}./uninstall.sh${C_RST}\n\n"
printf "${C_BOLD}Default login:${C_RST} ${C_CYA}admin / changeme${C_RST}\n\n"
