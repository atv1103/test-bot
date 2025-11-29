FROM node:20-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install

COPY *.ts ./
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]