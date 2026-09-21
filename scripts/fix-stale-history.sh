#!/usr/bin/env bash
# Fix stale history after the 2026-09-21 scrub that removed data/tokens.db from git.
# Run this once if `git pull` says "divergent branches" or CI guard says
# "History contains runtime DB files".
#
# Usage:
#   bash scripts/fix-stale-history.sh            # fixes develop + current branch
#   bash scripts/fix-stale-history.sh --all      # also fixes all local branches
#   bun run fix:history                          # same via package.json

set -euo pipefail

REMOTE="${REMOTE:-origin}"
BASE_BRANCH="${BASE_BRANCH:-develop}"

echo "==> Fetching $REMOTE..."
git fetch "$REMOTE" --prune

# If local develop has diverged due to history rewrite, hard-reset it
if git rev-parse --verify develop >/dev/null 2>&1; then
  if ! git merge-base --is-ancestor "develop" "$REMOTE/$BASE_BRANCH" 2>/dev/null && \
     ! git merge-base --is-ancestor "$REMOTE/$BASE_BRANCH" develop 2>/dev/null; then
    echo "==> Local 'develop' has diverged (history rewrite). Resetting to $REMOTE/$BASE_BRANCH..."
    git checkout develop
    git reset --hard "$REMOTE/$BASE_BRANCH"
    echo "✓ develop reset"
  else
    # Fast-forward if possible
    if git rev-parse --verify "$REMOTE/$BASE_BRANCH" >/dev/null 2>&1; then
      echo "==> Updating develop..."
      git checkout develop 2>/dev/null || true
      git merge --ff-only "$REMOTE/$BASE_BRANCH" 2>/dev/null || git reset --hard "$REMOTE/$BASE_BRANCH" || true
    fi
  fi
else
  echo "==> No local develop branch, creating from $REMOTE/$BASE_BRANCH"
  git checkout -b develop "$REMOTE/$BASE_BRANCH"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "develop")

# Fix current feature branch if it's not develop/main and has stale history
if [ "$CURRENT_BRANCH" != "develop" ] && [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "HEAD" ]; then
  # Check if current branch contains the leaked file in its history that develop no longer has
  if git log --all --name-only --pretty=format: 2>/dev/null | grep -q "data/tokens.db" 2>/dev/null; then
    # Only rebase if current branch is not already based on new develop
    if ! git merge-base --is-ancestor "$REMOTE/$BASE_BRANCH" HEAD 2>/dev/null; then
      echo "==> Current branch '$CURRENT_BRANCH' is based on pre-scrub history. Rebasing onto $REMOTE/$BASE_BRANCH..."
      # Stash any local changes first
      STASHED=0
      if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "    Stashing local changes..."
        git stash push -m "fix-stale-history autostash" --include-untracked
        STASHED=1
      fi
      if git rebase "$REMOTE/$BASE_BRANCH"; then
        echo "✓ Rebased $CURRENT_BRANCH onto $REMOTE/$BASE_BRANCH"
      else
        echo "!! Rebase hit conflicts. Resolve them, then run: git rebase --continue"
        echo "   If you get stuck: git rebase --abort && git rebase --onto $REMOTE/$BASE_BRANCH <old-base> $CURRENT_BRANCH"
        exit 1
      fi
      if [ "$STASHED" -eq 1 ]; then
        echo "    Restoring stashed changes..."
        git stash pop || true
      fi
    else
      echo "==> Current branch '$CURRENT_BRANCH' already based on new $BASE_BRANCH, no rebase needed"
    fi
  fi
fi

# Optionally fix all local branches
if [ "${1:-}" = "--all" ]; then
  echo "==> Checking all local branches for stale history..."
  for branch in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
    if [ "$branch" = "develop" ] || [ "$branch" = "main" ]; then continue; fi
    if git merge-base --is-ancestor "$REMOTE/$BASE_BRANCH" "$branch" 2>/dev/null; then
      echo "  ✓ $branch OK"
    else
      if git log "$branch" --name-only --pretty=format: 2>/dev/null | grep -q "data/tokens.db"; then
        echo "  ! $branch is stale (contains data/tokens.db) – run: git checkout $branch && git rebase $REMOTE/$BASE_BRANCH"
      else
        echo "  ? $branch not ancestor of $REMOTE/$BASE_BRANCH but no leaked file – may need rebase anyway"
      fi
    fi
  done
fi

# Check if local DB files are now correctly ignored (not tracked)
if git ls-files | grep -Eq '\.db$|\.db-shm$|\.db-wal$' 2>/dev/null; then
  echo "!! Still tracking .db files:"
  git ls-files | grep -E '\.db($|-shm$|-wal$)'
  echo "   Run: git rm --cached <file>"
else
  echo "==> No .db files tracked (correct – they are now ignored)"
fi

if [ -d "data" ] && [ -f "data/tokens.db" ]; then
  echo "==> Local runtime DBs exist on disk (expected, they are now ignored):"
  ls -lh data/*.db* 2>/dev/null || true
  echo "   Keep them – just don't commit. They are in .gitignore."
fi

echo ""
echo "Done. If you had a feature branch, verify: git log --oneline -5"
echo "If CI still says 'History contains runtime DB files', ensure you pushed the rebased branch with --force-with-lease"
