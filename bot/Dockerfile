FROM node:20-slim

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.js .
COPY .env .

EXPOSE 3000

CMD ["node", "index.js"]
