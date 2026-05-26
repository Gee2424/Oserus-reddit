#!/usr/bin/env bash
# Reddit Manager — uninstaller (macOS / Linux)
# Transparent: lists exactly what will be deleted, asks before doing it.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ -t 1 ]; then
  C_BOLD="\033[1m"; C_DIM="\033[2m"; C_RED="\033[31m"; C_GRN="\033[32m"; C_YEL="\033[33m"; C_CYA="\033[36m"; C_RST="\033[0m"
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GRN=""; C_YEL=""; C_CYA=""; C_RST=""
fi

printf "\n${C_BOLD}Reddit Manager — uninstaller${C_RST}\n\n"

OS=$(uname)
if [ "$OS" = "Darwin" ]; then
  DATA_DIR="$HOME/Library/Application Support/reddit-manager"
else
  DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/reddit-manager"
fi

# Build the list of paths that actually exist
declare -a TARGETS
declare -a LABELS
declare -a SIZES

get_size() {
  if [ -e "$1" ]; then
    du -sh "$1" 2>/dev/null | awk '{print $1}'
  else
    echo "—"
  fi
}

if [ -d "$SCRIPT_DIR/node_modules" ]; then
  TARGETS+=("$SCRIPT_DIR/node_modules")
  LABELS+=("Installed Node dependencies")
  SIZES+=("$(get_size "$SCRIPT_DIR/node_modules")")
fi

if [ -d "$SCRIPT_DIR/dist" ]; then
  TARGETS+=("$SCRIPT_DIR/dist")
  LABELS+=("Build output")
  SIZES+=("$(get_size "$SCRIPT_DIR/dist")")
fi

if [ -d "$DATA_DIR" ]; then
  TARGETS+=("$DATA_DIR")
  LABELS+=("App data (database, Reddit sessions, settings)")
  SIZES+=("$(get_size "$DATA_DIR")")
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  printf "${C_GRN}✓ Nothing to clean up.${C_RST} The app hasn't created any files outside this folder.\n\n"
  printf "${C_DIM}To remove the project itself, just delete this folder:${C_RST}\n"
  printf "  ${C_CYA}$SCRIPT_DIR${C_RST}\n\n"
  exit 0
fi

printf "${C_BOLD}The following will be permanently deleted:${C_RST}\n\n"
for i in "${!TARGETS[@]}"; do
  printf "  ${C_RED}✗${C_RST} ${C_CYA}${TARGETS[$i]}${C_RST}\n"
  printf "     ${C_DIM}${LABELS[$i]} — ${SIZES[$i]}${C_RST}\n\n"
done

printf "${C_YEL}This will sign you out of every Reddit account stored in the app${C_RST}\n"
printf "${C_YEL}and erase all drafts, profiles, and team data. This cannot be undone.${C_RST}\n\n"

read -p "Type 'delete' to confirm: " CONFIRM
if [ "$CONFIRM" != "delete" ]; then
  printf "\n${C_DIM}Cancelled. Nothing was deleted.${C_RST}\n\n"
  exit 0
fi

printf "\n"
for i in "${!TARGETS[@]}"; do
  printf "  Removing ${TARGETS[$i]}… "
  rm -rf "${TARGETS[$i]}"
  if [ ! -e "${TARGETS[$i]}" ]; then
    printf "${C_GRN}done${C_RST}\n"
  else
    printf "${C_RED}FAILED${C_RST} (check permissions)\n"
  fi
done

printf "\n${C_GRN}${C_BOLD}✓ All app data removed.${C_RST}\n\n"
printf "${C_BOLD}Last step — delete the project folder itself:${C_RST}\n"
printf "  ${C_YEL}rm -rf \"$SCRIPT_DIR\"${C_RST}\n\n"
printf "${C_DIM}(can't delete from inside itself — run that from somewhere else)${C_RST}\n\n"
