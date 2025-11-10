#!/bin/bash

# Script to install git hooks for SchroDrive
echo "Installing SchroDrive git hooks..."

# Make sure the .git/hooks directory exists
mkdir -p .git/hooks

# Copy the pre-push hook if it exists in the scripts directory
if [ -f "pre-push" ]; then
  cp pre-push .git/hooks/
  echo "Installed pre-push hook from scripts directory"
elif [ -f ".git/hooks/pre-push" ]; then
  echo "Pre-push hook already exists"
else
  echo "Warning: pre-push hook not found"
fi

# Make the hook executable
chmod +x .git/hooks/pre-push

echo "Git hooks installation complete!"
echo "The pre-push hook will automatically increment the version when pushing to main/master."
echo "It uses npm/node if available, otherwise falls back to manual version parsing."
