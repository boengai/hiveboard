#!/bin/bash
set -e

echo "Installing latest @anthropic-ai/claude-code..."
npm install -g @anthropic-ai/claude-code --silent 2>&1
echo "Claude Code $(claude --version) ready."

exec "$@"
