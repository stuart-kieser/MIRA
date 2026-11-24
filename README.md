# Mira

Mira reconstructs objects, outdoor scenes, and interiors from phone video as explorable Gaussian splats. The hosted app and local GPU processing are independent:

```text
Customer browser -> React + Express -> PostgreSQL
                            |
                     Private persistent storage
                     (videos + finished splats)
                            |
                  Admin downloads source video
                            v
                Your laptop: COLMAP + Gaussian tools
                            |
                  Admin uploads finished splat
```

The app does not connect to a GPU worker or payment gateway. Customers can upload and view completed spaces while your laptop is offline. Your home machine needs no public endpoint.

## Setup

Start your local PostgreSQL service and create a database named `mira`. Set `DATABASE_URL` in `.env` to use your local PostgreSQL role, password, and port. The role needs permission to create tables in the database schema. An administrator can install the initial extension with `CREATE EXTENSION IF NOT EXISTS pgcrypto;` in `mira`.

```powershell
npm install
Copy-Item .env.example .env
# Set DATABASE_URL for your local PostgreSQL instance.
npm run db:auth:migrate
npm run db:migrate
npm run dev
```

Open http://localhost:5173. Set `DEV_BYPASS_PAYWALL=false` to exercise the real credit flow; any development bypass is always disabled in production.

Register an account, then grant yourself administrator access:

```powershell
npm run admin:grant -- you@example.com
```

The admin dashboard is at `/admin`. `ADMIN_EMAILS` is an optional bootstrap/recovery list. Ordinary role and access management remains in the admin dashboard.

## EFT and credits

1. Set `EFT_INSTRUCTIONS` in `.env` to your actual bank details, payment contact, and instructions. No bank details are invented or supplied by the application.
2. Customers open **Usage & billing**, choose a quality, and click **Order by EFT**. The app records the quoted amount and a unique payment reference. Repeating an unpaid order for the same quality returns the existing order.
3. Customers transfer the quoted amount using that reference. Pending orders are visible in their billing history.
4. Check your bank account, then open **Admin > Payments**, locate the customer/reference, and click **Confirm EFT**. Enter the bank transaction reference only after verifying the full amount. This makes one quality-specific credit available. Confirm each order separately; one bank transaction reference cannot be credited twice.
5. Customers submit their video. One matching credit is deducted atomically when the uploaded video and order are recorded. Insufficient-credit or invalid submissions do not spend a credit.

The existing first-free-scan allowance is retained. A failed free attempt restores that allowance. Later paid submissions require the selected quality's credit; advanced tuning uses Maximum. **Admin > Customers > Grant scan credits** remains available for complimentary/manual adjustments; use **Payments** for EFT receipts so revenue is recorded correctly.

Live prices are managed under **Admin > Pricing**. Pending orders retain their original quoted amount. Credits, consumption, and returns have a persistent history, and administrator actions are audited. Returning a scan credit is an account-credit refund, not a bank transfer.

## Capture a walkthrough

In your workspace, open **New capture > Open camera**. Use **Record video** to record a silent walkthrough in the browser over HTTPS. You can review it, save a copy, and submit it using the same quality and credit controls as an uploaded video. The site can also be added to your phone’s home screen.

**Record with tracking** is available where WebXR immersive AR and camera-image access are exposed, typically on compatible Android devices with Chrome and Google Play Services for AR. It saves paired camera images and poses in a `.miracapture` file. Start in the orientation you want to keep and walk slowly with overlapping views. iPhone uses the regular video option.

## Processing an order

1. Open **Admin > Scans**, filter **Submitted**, and find the customer and order ID.
2. Download the source video or tracked capture. The original filename and requested quality are shown. Custom orders also include frames, training steps, and downscale.
3. Click **Mark processing**. Run videos through COLMAP and your Gaussian tools on your laptop. For a `.miracapture` file, select it in the local worker beta and use the order’s quality and tuning. The worker tries triangulation with the phone’s poses first, then falls back to image-based camera alignment if the tracked model is unusable. The hosted app does not start the worker for you.
4. On that same order, choose the finished `.ply`, `.splat`, `.ksplat`, `.spz`, or `.sog` file (up to 1.5 GB) and click **Upload and complete order**. Use a Gaussian-splat model rather than an ordinary point-cloud PLY.
5. The result appears in the customer's workspace and opens in the existing viewer. Open workspaces refresh active orders every 15 seconds. No live GPU metrics or completion-time estimates are promised for manual processing.

If processing fails, click **Mark failed** and provide a customer-facing explanation. For a paid order, click **Return scan credit** to restore the consumed credit. Repeated returns are rejected. Failed orders are final; the customer submits a new order to retry. Completed orders cannot be failed or credit-refunded through this workflow. A completed model cannot be overwritten accidentally.

## Storage and hosting

`STORAGE_DIRECTORY` defaults to `storage/`, outside the public frontend directory. Use an absolute path to a durable private disk/volume on the app server. Back up **both this directory and PostgreSQL together**. A deployment must reuse the same storage volume; files must not live only in an ephemeral container filesystem. This version supports one app server with durable local storage. Multiple replicas require shared storage or an object-storage implementation.

Files are streamed to disk, with a 3 GB source capture limit. Only administrators can download source captures. Only the owning active customer or an administrator can retrieve finished models. Storage keys are generated by the server; filenames are display/download metadata. Removed orders and their files are retained for restoration. Account deletion does not purge physical files automatically; define a retention process before relying on deletion for erasure. Interrupted processes can leave unreferenced files; reconcile against stored file keys before removing any files.

Production settings:

- `NODE_ENV=production`, a unique 32+ character `BETTER_AUTH_SECRET`, `APP_URL`, and `DATABASE_URL`.
- `DEV_BYPASS_PAYWALL=false`, real `EFT_INSTRUCTIONS`, and durable `STORAGE_DIRECTORY`.
- SMTP credentials and `EMAIL_FROM` for authentication email. Set `REQUIRE_EMAIL_VERIFICATION=true` when ready. Completion is shown in the workspace; this change does not add completion emails.
- Run authentication/application migrations, then `npm run build` and `npm start` behind HTTPS.
- See `deploy/nginx.example.conf` for large-upload limits/timeouts and optional separate `ADMIN_APP_URL` hostname. Keep storage outside the web root. Ensure proxy temporary storage has enough space.

No Paystack secret, worker URL, GPU, CUDA, or COLMAP installation is required on the app server. Legacy payment records remain available for history, but gateway routes are disabled.

## Existing scans and local GPU tools

### Live splat beta

The standalone local beta lives at **http://127.0.0.1:8787/beta/** on your GPU machine. It runs independently of the hosted customer platform and needs no PostgreSQL connection.

After finishing any active GPU jobs, build/start the worker with `docker compose --profile gpu up --build -d reconstruction-worker`. The image includes the beta frontend. Enter your `.env` `RECONSTRUCTION_WORKER_TOKEN` in the page, click **Connect & load jobs**, then upload a video with **Build with live preview** or select an existing job.

New beta jobs capture real Gaussian parameters after training iterations. Snapshots refresh no more often than every 15 seconds at 250-step intervals, keep your camera position between updates, and are capped at 200,000 splats with basic colour to limit transfer and rendering cost. This is a periodic preview, not a frame-by-frame training stream. Camera matching happens before the first snapshot. Preview capture adds some CPU/GPU synchronization overhead; it is opt-in and a preview failure does not stop training. Only the latest three snapshots are retained, not a replay of the whole build.

Use **Live updates** to pause visual refresh, **Reset view** to frame the scene, and **Load final model** for full exported detail. When done, **Download final PLY**, then upload it to the customer's order in Admin > Scans as usual. You can also open a finished local splat without connecting to the worker. Earlier jobs can show their status and final result, but cannot acquire live previews retroactively.

Worker tokens stay in tab memory, and the job list, previews, and model APIs require the worker token when configured. The Docker port binds to localhost. This beta is intended for your GPU laptop, not the public application host.

For frontend development: `npm run dev:beta` opens a separate Vite server at http://127.0.0.1:5174/beta/ and proxies requests to the local worker. `npm run build:beta` builds the standalone assets; `npm run test:beta` checks desktop/mobile snapshot updates. Worker snapshot, authorization, and callback tests run with `python -m worker.test_preview` in the GPU image.

Migration `007_manual_fulfilment.sql` adds storage references and the credit event ledger without deleting existing accounts, scans, or credits. Event history starts when this migration is applied; it does not fabricate earlier activity.

Previous source videos and completed models were stored on the old worker. Import them before retiring it:

```powershell
npm run storage:import-worker -- --container mira-reconstruction-worker-1
# Alternatively, use a local copy of the worker's data directory:
npm run storage:import-worker -- --directory C:\worker-data
```

This command copies sources and completed models into private app storage, preserves ownership and existing scan IDs, and records imports in the audit log. It is safe to repeat: existing storage references are skipped. Originals and running GPU jobs are left intact. Missing files are reported for manual recovery. You can also use **Admin > Scans > Upload and complete order** to import a legacy model individually. Until imported, a legacy model is unavailable from the hosted app. Existing unfinished worker jobs no longer sync automatically: finish them locally and upload the result, or mark them failed and return their credit.

The optional local worker remains in `worker/` for your own processing setup. Start it explicitly with:

```powershell
docker compose --profile gpu up --build -d reconstruction-worker
```

Do not rebuild or restart an existing worker while it is processing a job. Its configured port binds to localhost on newly created containers. See `worker/README.md` for its GPU requirements and local API; the customer platform no longer calls it.

## Verification

```powershell
npm run build
npm run lint
npm run test:server
npm run test:e2e
docker compose config --quiet
```

Tests require PostgreSQL and applied migrations. The manual workflow integration test starts an isolated API and temporary file storage with an unreachable GPU URL. It verifies EFT confirmation, duplicate protection, ownership, video download, result upload/serving, concurrent credit spending, failures, and credit returns. Browser tests use ports 3002 and 4173; no GPU is needed.
#   M I R A  
 