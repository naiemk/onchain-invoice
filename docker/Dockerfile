FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run compile && npm run fastswap:build && npm run liqman:build

FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/app-dist ./app-dist
COPY --from=build /app/lm-dist ./lm-dist
COPY --from=build /app/artifacts ./artifacts
ENV NODE_ENV=production
CMD ["node", "app-dist/fastswap/app/fastswap/server/main.js"]
