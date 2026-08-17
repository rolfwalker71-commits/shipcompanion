FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3344
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx@4.23.12
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
RUN mkdir -p data
EXPOSE 3344
CMD ["npx", "tsx", "server/index.ts"]
