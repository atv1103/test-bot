FROM node:20-bullseye

# Установка необходимых инструментов
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    vim \
    nano \
    python3 \
    python3-pip \
    docker.io \
    docker-compose \
    && rm -rf /var/lib/apt/lists/*

# Установка глобальных npm пакетов для разработки
RUN npm install -g \
    typescript \
    tsx \
    nodemon \
    eslint \
    prettier

# Создание рабочей директории
WORKDIR /workspace

# Настройка пользователя
RUN usermod -aG docker node

USER node

CMD ["sleep", "infinity"]
