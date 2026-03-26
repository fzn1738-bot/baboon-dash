FROM node:20-slim AS builder

WORKDIR /app

# Install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built assets and server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.mjs ./
COPY --from=builder /app/firebase-applet-config.json ./

# Expose the port
EXPOSE 3000

# Start the server
CMD ["node", "server.mjs"]
