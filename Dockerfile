FROM node:22-alpine AS builder

WORKDIR /app

# Copy package management files
COPY package.json package-lock.json* ./

# Install all dependencies (including dev tools for build)
RUN npm install

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Production image
FROM node:22-alpine AS runner

WORKDIR /app

# Set node env to production
ENV NODE_ENV=production

RUN apk add --no-cache poppler-utils font-noto

# Copy necessary files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./

# Install only production dependencies
RUN npm install --omit=dev

# Expose port (Cloud Run defaults to 8080, but our app binds to 3000. Let's expose 3000)
# Note: Express should listen on the port specified by the PORT environment variable if present.
# Our applet uses hardcoded 3000 locally, but we should make sure it doesn't break.
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
