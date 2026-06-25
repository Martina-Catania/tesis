# catania-tesis

What it does so far
--------------------

- **WhatsApp integration**: Implements a lightweight wrapper around the Facebook/Meta WhatsApp Business API located in [src/modules/whatsapp](src/modules/whatsapp). The module contains:
	- `client.ts`: HTTP client and low-level API calls.
	- `graph-api.ts`: helpers for calling the Graph API endpoints.
	- `message.ts`: message construction and formatting utilities.
	- `status.ts`: delivery/status handling and mapping.
	- `index.ts`: high level entry that ties the pieces together for use by controllers.

This is heavily based on Facebook's whatsapp-business-jaspers-market app - might get refactored in the future to follow the same controllers/services/routes pattern the other services have.
The biggest changes I made so far are changing the code from Common-JS to EMS (requires -> import) and adding a handler to fix an issue with arg phone numbers (+54 9 is not a valid area code when sending messages, only when recieving).

- **Bultos (packages) domain**: Basic structure for handling "bultos" under [src/modules/bultos](src/modules/bultos).
	- `controllers.ts` and `types.ts`: controller layer and type definitions for the domain.
	- `services/formatter.ts` and `services/parser.ts`: utilities to parse and format package data for storage and messaging; these have accompanying unit tests (`formatter.test.ts`, `parser.test.ts`).
	- `services/storage.ts`: simple storage adapter used by the bultos services, with tests in `storage.test.ts`.

NOTE: Packages with errors will get displayed in a seperate page when exported to Excel and admin will manually fix them, no way to correct them yet via WhatsApp.
Approach validated with PO (admin).

- **Shared utilities & DB**: Common code used across modules in [src/shared](src/shared):
	- `db/prisma.ts` and `db/index.ts`: Prisma client and database helpers.
	- `utils/config.ts` and `utils/index.ts`: configuration loading and misc helpers.
	- `utils/redis.ts`: Redis connection wrapper used for caching or pub/sub.

--------------------
To run:
--------------------

### Prerequisites

- **Node.js**: v20.20.2 (check with `node --version`)
- **Redis**: Installed and available on your system
- **ngrok**: Installed for tunneling webhooks (get it from https://ngrok.com)
- **WhatsApp Business Account**: With API credentials configured
- **WSL2** (recommended for Windows users)

### Setup Steps

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   - Create a `.env` file in the root directory with your WhatsApp API credentials and configuration
   - Required variables: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WEBHOOK_VERIFY_TOKEN`, etc.

3. **Setup Prisma database**
   ```bash
   npx prisma migrate deploy
   ```
   This initializes the SQLite database with the schema.

4. **Enable Redis memory overcommit** (required for Redis stability on Linux/WSL)
   ```bash
   sudo sysctl vm.overcommit_memory=1
   ```

5. **Start Redis server**
   ```bash
   redis-server --daemonize yes
   ```
   Verify it's running with: `redis-cli ping` (should return `PONG`)

6. **Start ngrok tunnel** (in a new terminal)
   ```bash
   ngrok http 8080
   ```
   Copy the HTTPS forwarding URL (e.g., `https://xxxx-xx-xxx-xxx-xx.ngrok.io`)

7. **Start the application** (in another new terminal)
   ```bash
   npm run start
   ```
   Or for development with hot reload:
   ```bash
   npm run dev
   ```

8. **Configure WhatsApp webhook**
   - Go to your WhatsApp Business App settings
   - Set Webhook URL to: `{ngrok_url}/webhook`
   - Verify the webhook is receiving events

9. **Verify the app is running**
   - The app should be listening on `http://localhost:8080`
   - Check logs for any errors
   - Test webhook connectivity through WhatsApp dashboard

### Running Tests

```bash
npm run test              # Run all tests
npm run test -- --coverage  # Run with coverage report
```

### Development Commands

```bash
npm run typecheck  # Check TypeScript types
npm run build      # Build for production
npm run dev        # Run with hot reload (tsx watch)
```

### Troubleshooting

- **Redis connection error**: Ensure Redis is running with `redis-cli ping`
- **Port 8080 already in use**: Change the port in your config or kill the process using it
- **Prisma migration issues**: Try `npx prisma migrate reset` to reset the database (development only)