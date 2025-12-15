FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --only=production

COPY src ./src

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["npm", "start"]


