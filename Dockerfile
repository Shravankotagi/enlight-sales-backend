# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install OpenSSL, libc dependencies, and build tools required by Prisma engine & bcrypt
RUN apk add --no-cache openssl libc6-compat python3 make g++

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies without git hooks
RUN npm ci --ignore-scripts

# Generate Prisma Client
RUN npx prisma generate

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
COPY prisma ./prisma/
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev --ignore-scripts && \
    apk del .build-deps && \
    npm cache clean --force

# Copy generated Prisma binaries and compiled dist from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
