# PayNGo Gateway Skeleton

Production-oriented NestJS architecture for crypto payments with:
- Mnemonic auth + JWT
- Merchant asset configuration
- Payment init + hosted page flow
- Price sync cron
- BullMQ workers for payment monitoring, webhook retry, and withdrawals
- Crypto adapter around existing Node.js `cryptoService`
- Angular iframe-ready hosted payment page

## Key guarantees
- Only business states: `PENDING`, `CONFIRMED`, `FAIL`
- Idempotent finalization guarded by conditional DB updates
- Private keys encrypted with AES-256 before persistence
- Webhook and redirect decoupled
- External service failures never crash process (retry + error handling)
