# PayNGo Monorepo

## Structure

```
src/
  api/      # NestJS backend
    src/
      modules/
      common/
      config/
      main.ts
    package.json
    .env.example
  client/   # Angular iframe payment UI
    src/
      app/
      environments/
    package.json
```

## Why HTTPS + JWT + HMAC (and no custom payload encryption)
- HTTPS/TLS already encrypts request and response bodies in transit using battle-tested standards.
- JWT secures authenticated merchant/admin APIs with stateless token verification.
- HMAC signatures are used for integrity/authenticity on sensitive callbacks (webhook delivery), so merchants can verify source and payload consistency.
- Manual body encryption is intentionally avoided because it adds operational risk, key-management complexity, and typically duplicates TLS while reducing interoperability.

## Run independently
- API dev: `npm run start:api`
- Client dev: `npm run start:client`
- API build: `npm run build:api`
- Client build: `npm run build:client`
