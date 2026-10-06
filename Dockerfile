# Image that tests and deploys the app to Cloudflare. Built and run by
# .github/workflows/deploy.yml on every push to master; also usable by hand:
#
#   docker build -t symbolic-deploy .
#   docker run --rm -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCOUNT_ID symbolic-deploy
#
# Credentials come from the environment when the container runs and are never stored in
# the image.

# Debian-based (not Alpine): Wrangler's local runtime needs glibc.
FROM node:24-slim

WORKDIR /app
ENV CI=true \
    WRANGLER_SEND_METRICS=false

# Dependencies first, so this layer is reused until package-lock.json changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["sh", "-c", "npm test && npx wrangler deploy"]
