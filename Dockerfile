FROM node:20-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy app code
COPY server.mjs supertonic.mjs ./

# Copy models (baked into image)
COPY models/ ./models/

EXPOSE 3100

ENV NODE_ENV=production
ENV PORT=3100

CMD ["node", "server.mjs"]
