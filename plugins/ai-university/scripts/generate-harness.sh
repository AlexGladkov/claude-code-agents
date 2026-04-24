#!/usr/bin/env bash
set -euo pipefail

# University Memory — harness file generator
# Reads config/university.yaml and generates instruction files for AI coding assistants.
# Requires: yq (https://github.com/mikefarah/yq)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$REPO_ROOT/config/university.yaml"
OUT_DIR="$REPO_ROOT/generated"

# --- Dependency check ---

if ! command -v yq &>/dev/null; then
  echo "Error: yq is required but not installed."
  echo "Install: brew install yq (macOS) | snap install yq (Linux) | go install github.com/mikefarah/yq/v4@latest"
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "Error: $CONFIG not found."
  exit 1
fi

# --- Args ---

INSTALL=false
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=true; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $(basename "$0") [--install] [--only <harness>]"
      echo ""
      echo "Generates AI harness instruction files from config/university.yaml."
      echo ""
      echo "Options:"
      echo "  --install       Copy generated files to their target locations"
      echo "  --only <name>   Generate only one harness: claude|cursor|copilot|windsurf|codex"
      echo ""
      echo "Generated files are placed in generated/ directory."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$OUT_DIR"

# --- Content generation ---

generate_content() {
  local uni_name uni_desc
  uni_name=$(yq '.university.name' "$CONFIG")
  uni_desc=$(yq '.university.description' "$CONFIG")

  local content=""
  content+="# $uni_name\n\n"
  content+="$uni_desc\n\n"
  content+="## Structure\n\n"

  local fac_count
  fac_count=$(yq '.university.faculties | length' "$CONFIG")

  for ((f=0; f<fac_count; f++)); do
    local fac_id fac_title fac_desc
    fac_id=$(yq ".university.faculties[$f].id" "$CONFIG")
    fac_title=$(yq ".university.faculties[$f].title" "$CONFIG")
    fac_desc=$(yq ".university.faculties[$f].description" "$CONFIG")

    content+="### $fac_title ($fac_id)\n\n"
    content+="$fac_desc\n\n"

    local dept_count
    dept_count=$(yq ".university.faculties[$f].departments | length" "$CONFIG")

    for ((d=0; d<dept_count; d++)); do
      local dept_id dept_title dept_desc head_file
      dept_id=$(yq ".university.faculties[$f].departments[$d].id" "$CONFIG")
      dept_title=$(yq ".university.faculties[$f].departments[$d].title" "$CONFIG")
      dept_desc=$(yq ".university.faculties[$f].departments[$d].description" "$CONFIG")
      head_file=$(yq ".university.faculties[$f].departments[$d].head-file" "$CONFIG")

      content+="#### $dept_title ($dept_id)\n\n"
      content+="$dept_desc\n\n"
      content+="Department head: \`$head_file\`\n\n"
      content+="| Дисциплина | Агент | Часы | Компетенции |\n"
      content+="|-----------|-------|------|-------------|\n"

      local disc_count
      disc_count=$(yq ".university.faculties[$f].departments[$d].disciplines | length" "$CONFIG")

      for ((i=0; i<disc_count; i++)); do
        local disc_title disc_file disc_hours disc_comps
        disc_title=$(yq ".university.faculties[$f].departments[$d].disciplines[$i].title" "$CONFIG")
        disc_file=$(yq ".university.faculties[$f].departments[$d].disciplines[$i].agent-file" "$CONFIG")
        disc_hours=$(yq ".university.faculties[$f].departments[$d].disciplines[$i].hours" "$CONFIG")
        disc_comps=$(yq ".university.faculties[$f].departments[$d].disciplines[$i].competencies | join(\", \")" "$CONFIG")

        content+="| $disc_title | \`$disc_file\` | $disc_hours | $disc_comps |\n"
      done

      content+="\n"
    done
  done

  # Cross-faculty programs
  local prog_count
  prog_count=$(yq '.university.cross-faculty-programs | length' "$CONFIG")

  if [[ "$prog_count" -gt 0 ]]; then
    content+="## Cross-Faculty Programs\n\n"
    for ((p=0; p<prog_count; p++)); do
      local prog_title prog_desc prog_hours
      prog_title=$(yq ".university.cross-faculty-programs[$p].title" "$CONFIG")
      prog_desc=$(yq ".university.cross-faculty-programs[$p].description" "$CONFIG")
      prog_hours=$(yq ".university.cross-faculty-programs[$p].hours" "$CONFIG")
      content+="### $prog_title\n\n$prog_desc\nHours: $prog_hours\n\n"
    done
  fi

  content+="## Usage\n\n"
  content+="To start learning, read the relevant agent file and invoke it as a subagent.\n"
  content+="For orchestrated learning, use the rector agent: \`agents/education/rector.md\`\n"
  content+="Source-of-truth: \`config/university.yaml\`\n"

  echo -e "$content"
}

# --- Harness-specific generators ---

generate_claude() {
  {
    echo "# University Structure"
    echo ""
    echo "This section describes the AI university structure in this repository."
    echo "When a user asks about learning or studying, use this structure to find the right agent."
    echo ""
    generate_content
  } > "$OUT_DIR/claude-university.md"
  echo "Generated: $OUT_DIR/claude-university.md"
}

generate_cursor() {
  {
    echo "# University Structure"
    echo ""
    echo "This repository contains AI teaching agents organized as a university."
    echo "Use the structure below to navigate education agents."
    echo ""
    generate_content
  } > "$OUT_DIR/cursorrules-university"
  echo "Generated: $OUT_DIR/cursorrules-university"
}

generate_copilot() {
  {
    echo "# University Structure"
    echo ""
    echo "AI teaching agents are organized in a university hierarchy."
    echo "Refer to the agent files listed below for subject-specific instruction."
    echo ""
    generate_content
  } > "$OUT_DIR/copilot-university.md"
  echo "Generated: $OUT_DIR/copilot-university.md"
}

generate_windsurf() {
  {
    echo "# University Structure"
    echo ""
    echo "This repository contains AI teaching agents organized as a university."
    echo ""
    generate_content
  } > "$OUT_DIR/windsurf-university"
  echo "Generated: $OUT_DIR/windsurf-university"
}

generate_codex() {
  {
    echo "# University Structure"
    echo ""
    echo "AI teaching agents organized as a university. Use the rector agent for orchestrated learning."
    echo ""
    generate_content
  } > "$OUT_DIR/agents-university.md"
  echo "Generated: $OUT_DIR/agents-university.md"
}

# --- Install ---

install_file() {
  local src="$1" dst="$2"
  if [[ -f "$dst" ]]; then
    read -r -p "Overwrite $dst? [y/N] " ans
    if [[ "$ans" != [yY] ]]; then
      echo "Skipped: $dst"
      return
    fi
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "Installed: $dst"
}

install_claude() {
  local dst="$REPO_ROOT/CLAUDE.md"
  local marker="# University Structure"

  if [[ -f "$dst" ]] && grep -qF "$marker" "$dst"; then
    echo "CLAUDE.md already contains University Structure section. Skipping."
    return
  fi

  if [[ -f "$dst" ]]; then
    echo "" >> "$dst"
    cat "$OUT_DIR/claude-university.md" >> "$dst"
    echo "Appended university section to: $dst"
  else
    cp "$OUT_DIR/claude-university.md" "$dst"
    echo "Installed: $dst"
  fi
}

do_install() {
  install_claude
  install_file "$OUT_DIR/cursorrules-university" "$REPO_ROOT/.cursorrules"
  install_file "$OUT_DIR/copilot-university.md" "$REPO_ROOT/.github/copilot-instructions.md"
  install_file "$OUT_DIR/windsurf-university" "$REPO_ROOT/.windsurfrules"
  install_file "$OUT_DIR/agents-university.md" "$REPO_ROOT/AGENTS.md"
}

# --- Main ---

if [[ -n "$ONLY" ]]; then
  case "$ONLY" in
    claude)   generate_claude ;;
    cursor)   generate_cursor ;;
    copilot)  generate_copilot ;;
    windsurf) generate_windsurf ;;
    codex)    generate_codex ;;
    *) echo "Unknown harness: $ONLY. Options: claude|cursor|copilot|windsurf|codex"; exit 1 ;;
  esac
else
  generate_claude
  generate_cursor
  generate_copilot
  generate_windsurf
  generate_codex
fi

if [[ "$INSTALL" == true ]]; then
  do_install
fi

echo "Done."
