# Core Banking API

Backend API for core banking: Keycloak auth (OTP, register, login, token refresh), Fineract accounts and products, beneficiaries, transfers, KYC onboarding webhook.

## Features

- **Auth** — Phone/email OTP verification, registration, login, token refresh, logout, password reset, userinfo; optional background Fineract onboarding after register
- **Accounts** — Get client and savings accounts (with transactions), create savings account, credit (e.g. deposit)
- **Products** — Get currency/savings products from Fineract
- **Beneficiaries** — List, add, delete client beneficiaries
- **Transfer** — Transfer request (channel integration)
- **KYC** — Onboarding webhook to trigger Fineract client + account creation

## Tech stack

- **Runtime:** Node.js  
- **Framework:** Express 4  
- **Auth:** Keycloak (JWT, JWKS), custom registration/OTP  
- **Core banking:** Fineract (clients, savings accounts, products), channel API (party registration, transfers)  
- **Logging:** Winston (centralized, levels, JSON in production)  
- **Errors:** Global error middleware, `AppError`, consistent JSON responses  
- **Docs:** OpenAPI 3 (Swagger UI at `/api-docs`)

## Prerequisites

- Node.js 18+
- Keycloak (main + optional internal realm for Fineract)
- Fineract instance
- (Optional) Channel API

## Installation

```bash
git clone <repository-url>
cd core-banking-api
npm install
```

Create a `.env` file with at least Keycloak and Fineract settings. See [Configuration](#configuration) below.

## Configuration

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `3000`) |
| `NODE_ENV` | `development` \| `production` |
| `LOG_LEVEL` | `error`, `warn`, `info`, `debug` |

### Keycloak

| Variable | Description |
|----------|-------------|
| `KEYCLOAK_URL` | Keycloak base URL (e.g. `http://localhost:8080/auth`) |
| `KEYCLOAK_REALM` | Main realm for app users |
| `KEYCLOAK_CLIENT_ID` | App client ID |
| `KEYCLOAK_CLIENT_SECRET` | App client secret |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Admin client ID |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Admin client secret |
| `KEYCLOAK_INTERNAL_REALM` | (Optional) Realm for Fineract service user |
| `KEYCLOAK_FINERACT_CLIENT_ID` | Fineract client ID |
| `KEYCLOAK_FINERACT_CLIENT_SECRET` | Fineract client secret |
| `KEYCLOAK_FINERACT_USERNAME` | Fineract service username |
| `KEYCLOAK_FINERACT_PASSWORD` | Fineract service password |
| `SUBJECT_ISSUER` | (Optional) Token exchange subject issuer |

### Fineract

| Variable | Description |
|----------|-------------|
| `FINERACT_BASE_URL` | Fineract API base URL |
| `FINERACT_TENANT` | Tenant identifier (e.g. `default`) |
| `FINERACT_BASE_PATH` | Base path (e.g. `/fineract-provider/api/v1`) |
| `OFFICE_ID` | Default office ID for client creation |
| `DEFAULT_SAVING_PRODUCT` | Default savings product ID |
| `BANK_CODE` | Bank code for IBAN generation |
| `COUNTRY_CODE` | Country code (e.g. `TN`) |
| `SWIFT_BIC` | (Optional) SWIFT/BIC for account display |

### Channel (transfers / party registration)

| Variable | Description |
|----------|-------------|
| `CHANNEL_BASE_URL` | Channel API base URL |
| `CHANNEL_BASE_PATH` | Base path |
| `FINERACT_TENANT` | Tenant for channel requests |

### Optional

| Variable | Description |
|----------|-------------|
| `FRONTEND_URL` | Frontend URL (e.g. password reset link) |
| `FRONTEND_APP_URL` | App URL (e.g. magic link) |

## Running

**Development:**

```bash
npm run dev
```

**Production:**

```bash
npm run build
npm start
```

**Docker:**

```bash
docker build -t nexusbank/core-banking-api .
docker run -p 3000:3000 --env-file .env nexusbank/core-banking-api
```

Tag and push:

```bash
docker build -t nexusbank/core-banking-api .
docker tag nexusbank/core-banking-api nexusbank/core-banking-api:latest
docker push nexusbank/core-banking-api:latest
```

The API is available at `http://localhost:3000` (or your `PORT`).

## API documentation

- **Swagger UI:** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
- **Health:** `GET /health` → `200 OK`

OpenAPI spec: `openapi.json` in the project root.

### Route overview

| Prefix | Description |
|--------|-------------|
| `/api/auth` | Registration, phone/email verify, login, token, logout, set-password, userinfo, magic link, etc. |
| `/api/account` | GET client/accounts, POST create savings account, POST credit/deposit |
| `/api/product` | GET currency products |
| `/api/beneficiary` | GET list, POST add, DELETE remove |
| `/api/transfer` | POST transfer request |
| `/api/kyc` | KYC / onboarding webhook |

Protected routes require:

```http
Authorization: Bearer <access_token>
fineract-platform-tenantid: <tenantId>   # for account/product/beneficiary
```

## Logging and error handling

- **Logging:** Winston is used across the app. Set `LOG_LEVEL=debug` for more detail. In development, logs are human-readable; in production, JSON.
- **Errors:** Unhandled errors are caught by a global middleware and returned as JSON `{ "message", "code"? }`. Auth errors (missing/expired/invalid token) use `AppError` and the same middleware. 4xx are logged as warnings, 5xx as errors.

## User onboarding flow (high level)

1. **Registration / first login** → OTP verification (phone/email)
2. **KYC / identity verification** → External flow; on approval, webhook can call onboarding
3. **Onboarding** → Create client in Fineract, create savings account, activate, (optional) assign IBAN, party registration (IBAN, email, MSISDN)
4. **Account active** → User can view accounts, add beneficiaries, request transfers, receive credit/deposit
5. **Step-up** (if required) → Passcode or biometric for sensitive actions
6. **Onboarding complete**

## Contributing

Contributions are welcome. Open an issue or submit a pull request.

## License

ISC
