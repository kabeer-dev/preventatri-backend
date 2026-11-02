FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Strip the "prepare": "husky" script so it doesn't run during install
# (husky is a devDependency and is absent under --omit=dev, which would
# otherwise fail the build). Install prod deps only, then generate Prisma client.
RUN npm pkg delete scripts.prepare \
  && npm ci --omit=dev --legacy-peer-deps \
  && npx prisma generate

COPY --chown=node:node . .

EXPOSE 3001

# Drop root privileges: run the app as the image's built-in non-root "node" user.
USER node

CMD ["npm", "start"]
