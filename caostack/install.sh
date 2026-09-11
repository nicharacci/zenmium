#!/usr/bin/env bash
# Fetch CAOstack base dependencies. Never copies solvys-skills or cabinets.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$root/vendor"
mkdir -p "$vendor" "$root/.agents/skills"

echo "CAOstack install. Excluding solvys-skills and internal cabinets."

if [[ ! -d "$vendor/pstack" ]]; then
  tmp="$(mktemp -d)"
  git clone --depth 1 --filter=blob:none --sparse https://github.com/cursor/plugins.git "$tmp/plugins"
  git -C "$tmp/plugins" sparse-checkout set pstack
  cp -R "$tmp/plugins/pstack" "$vendor/pstack"
  rm -rf "$tmp"
  echo "vendored pstack -> vendor/pstack"
else
  echo "vendor/pstack already present"
fi

ln -sfn ../../caostack/skills/caostack "$root/.agents/skills/caostack"
ln -sfn ../../vendor/pstack/skills/poteto-mode "$root/.agents/skills/poteto-mode"

# Catalog pointers only. Do not clone paid zips or private cabinets.
cat > "$root/.agents/skills/README.md" <<'EOF'
# Skills catalog

- `caostack` overlay (this repo)
- `poteto-mode` from vendored pstack
- Ponytail, shadcn-cssinjs, impeccable, clipth: install from `caostack/lock.json` sources in Goalpost Code or Cursor. Do not vendor solvys-skills.
EOF

echo "CAOstack ready. Next: pnpm install, then pnpm validate."
