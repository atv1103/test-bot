.PHONY: help build up down restart logs logs-bot logs-whisper logs-ocr clean test rebuild status shell-bot shell-whisper shell-ocr dev-up dev-down

help:
	@echo "Available commands:"
	@echo "  make build          - Build all containers"
	@echo "  make up             - Start all services"
	@echo "  make down           - Stop all services"
	@echo "  make restart        - Restart all services"
	@echo "  make logs           - Show logs (all services)"
	@echo "  make logs-bot       - Show bot logs"
	@echo "  make logs-whisper   - Show Whisper logs"
	@echo "  make logs-ocr       - Show OCR logs"
	@echo "  make clean          - Remove all containers, volumes, images"
	@echo "  make test           - Test health endpoints"
	@echo "  make rebuild        - Rebuild and restart"
	@echo "  make status         - Show container status"
	@echo "  make shell-bot      - Open shell in bot container"
	@echo "  make shell-whisper  - Open shell in whisper container"
	@echo "  make shell-ocr      - Open shell in ocr container"
	@echo "  make dev-up         - Start dev environment with devcontainer"
	@echo "  make dev-down       - Stop dev environment"

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f

logs-bot:
	docker compose logs -f bot

logs-whisper:
	docker compose logs -f whisper

logs-ocr:
	docker compose logs -f ocr

clean:
	docker compose down -v --rmi all --remove-orphans
	rm -rf bot/tmp whisper/tmp ocr/tmp

test:
	@echo "Testing Whisper health..."
	@curl -s http://localhost:8000/health | jq || echo "Whisper not available"
	@echo "\nTesting OCR health..."
	@curl -s http://localhost:9001/health | jq || echo "OCR not available"

rebuild:
	docker compose down
	docker compose build --no-cache
	docker compose up -d

status:
	docker compose ps

shell-bot:
	docker compose exec bot sh

shell-whisper:
	docker compose exec whisper bash

shell-ocr:
	docker compose exec ocr bash

dev-up:
	docker compose -f docker-compose.dev.yml up -d

dev-down:
	docker compose -f docker-compose.dev.yml down
