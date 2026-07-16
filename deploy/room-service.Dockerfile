FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=3001
ENV ROOM_DATABASE_PATH=/data/roboarena.sqlite
VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "run", "start:server"]
