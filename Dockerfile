FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 80

ENV PORT=80
ENV NODE_ENV=production

CMD ["node", "server.js"]
