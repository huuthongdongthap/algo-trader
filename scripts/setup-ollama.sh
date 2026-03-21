#!/bin/bash
# Setup Ollama LLM gateway on M1 Max for OpenClaw AI
# Usage: bash scripts/setup-ollama.sh

set -e

echo "=== OpenClaw Ollama Gateway Setup ==="

# Check if Ollama is installed
if ! command -v ollama &>/dev/null; then
  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "Ollama already installed: $(ollama --version)"
fi

# Start Ollama service if not running
if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
  echo "Starting Ollama service..."
  ollama serve &
  sleep 3
fi

# Pull recommended models for M1 Max (64GB unified memory)
echo ""
echo "Pulling models for OpenClaw tiers..."

echo "--- Simple tier: llama3.1:8b ---"
ollama pull llama3.1:8b

echo "--- Standard tier: deepseek-r1:32b ---"
ollama pull deepseek-r1:32b

echo ""
echo "=== Setup Complete ==="
echo "Gateway URL: http://localhost:11434/v1"
echo "Models ready for OpenClaw routing"
echo ""
echo "Set in .env (optional overrides):"
echo "  OPENCLAW_GATEWAY_URL=http://localhost:11434/v1"
echo "  OPENCLAW_MODEL_SIMPLE=llama3.1:8b"
echo "  OPENCLAW_MODEL_STANDARD=deepseek-r1:32b"
echo "  OPENCLAW_MODEL_COMPLEX=deepseek-r1:32b"
echo ""
echo "Test: curl http://localhost:11434/v1/chat/completions -d '{\"model\":\"llama3.1:8b\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}'"
