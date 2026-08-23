# Self-Hosting Beaver-Sync

## Quick Start (Single VPS)

### 1. Prerequisites

- Docker + Docker Compose v2
- A domain name pointed at your VPS IP
- Ports 80 and 443 open

### 2. Clone and configure

```bash
git clone https://github.com/your-org/beaver-sync.git
cd beaver-sync
cp .env.production.example .env
```

Edit `.env` — only these are required:

| Variable | How to generate |
|----------|----------------|
| `DATABASE_URL` | Set POSTGRES_PASSWORD below, then update the URL |
| `POSTGRES_PASSWORD` | `openssl rand -hex 16` |
| `APP_URL` | Your domain, e.g. `https://sync.yourdomain.com` |
| `COOKIE_SECRET` | `openssl rand -hex 32` |
| `SESSION_HMAC_KEY` | `openssl rand -hex 32` |
| `EMAIL_HMAC_KEY` | `openssl rand -hex 32` |
| `NOTE_HMAC_KEY` | `openssl rand -hex 32` |
| `MLKEM_SEED` | `openssl rand -hex 64` |
| `WEBAUTHN_RPID` | Your domain without protocol, e.g. `sync.yourdomain.com` |
| `WEBAUTHN_ORIGIN` | `https://sync.yourdomain.com` |

### 3. Start

```bash
docker compose -f docker-compose.prod.yml up -d
```

Caddy automatically provisions a Let's Encrypt certificate. Your server is now
available at `https://your-domain.com`.

### 4. Verify

```bash
docker compose -f docker-compose.prod.yml ps    # all healthy
curl https://your-domain.com/api/health          # {"status":"ok"}
```

## Adding Cloudflare R2 (Recommended)

1. Create an R2 bucket at https://dash.cloudflare.com
2. Create an API token with R2 read/write permissions
3. Add to `.env`:

```env
STORAGE_BACKEND=cloudflare-r2
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-key-id
R2_SECRET_ACCESS_KEY=your-secret
STORAGE_BUCKET_NAME=beaver-sync
```

4. Enable the R2 public bucket URL for asset downloads:
   R2 dashboard → your bucket → Settings → Public Access → enable

5. Set `STORAGE_PUBLIC_ENDPOINT` to the public URL.

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

## Backups

Postgres data is in the `pg_data` volume. Back up with:

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U beaver beaver > backup.sql
```

## Troubleshooting

- **Caddy not provisioning cert:** Ensure port 80 is open and DNS points to your VPS
- **WS relay connection failed:** Check `APP_URL` matches your domain exactly
- **"database is locked":** Ensure only one API container is running
