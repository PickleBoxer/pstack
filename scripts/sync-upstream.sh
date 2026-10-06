#!/usr/bin/env bash
# Refresh upstream-pstack (the pstack/ subtree of cursor/plugins) and list what main has not merged yet.
set -euo pipefail

git fetch upstream
git branch -f upstream-pstack "$(git subtree split --prefix=pstack upstream/main)"

echo "Upstream version: $(git show upstream-pstack:.cursor-plugin/plugin.json | grep '"version"')"
git log --oneline main..upstream-pstack
