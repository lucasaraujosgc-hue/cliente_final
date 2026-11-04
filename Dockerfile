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
# The SQL migration files are read at runtime by dist/migrate.cjs.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./

# Install only production dependencies
RUN npm install --omit=dev

# The app honours process.env.PORT (Cloud Run injects it); 3000 is the default.
ENV PORT=3000
EXPOSE 3000

# `npm run start` fires the "prestart" hook first: node dist/migrate.cjs,
# which applies pending DB migrations before the server accepts traffic.
CMD ["npm", "run", "start"]
