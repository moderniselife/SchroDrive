#!/bin/bash

# Script to install git hooks for SchroDrive
echo "Installing SchroDrive git hooks..."

# Make sure the .git/hooks directory exists
mkdir -p .git/hooks

# Copy the pre-commit hook if it exists in the scripts directory
if [ -f "pre-commit" ]; then
  cp pre-commit .git/hooks/
  echo "Installed pre-commit hook from scripts directory"
elif [ -f ".git/hooks/pre-commit" ]; then
  echo "Pre-commit hook already exists"
else
  echo "Warning: pre-commit hook not found"
fi

# Make the hook executable
chmod +x .git/hooks/pre-commit

echo "Git hooks installation complete!"
echo "The pre-commit hook will automatically increment the version when committing to main/master."
echo "It uses npm/node if available, otherwise falls back to manual version parsing."
echo "This ensures the version bump is part of the original commit, eliminating push conflicts."
