---
title: File storage
description: Keep encrypted files on the server's disk or in an S3-compatible bucket such as Cloudflare R2, and move between them without downtime.
---

Files are encrypted before they reach the API, so wherever they are stored
only ever holds ciphertext. There are two drivers:

| `BLOB_DRIVER` | Files live in                                                  |
| ------------- | -------------------------------------------------------------- |
| `fs`          | The data volume, `/srv/skillpouch/blobs` (default)             |
| `s3`          | Any S3-compatible bucket: Cloudflare R2, AWS S3, MinIO, Garage |

With `s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` are all required; the API refuses to start without
them. `S3_REGION` defaults for R2 (`auto`), and `S3_PREFIX` puts the files
in a folder inside the bucket, e.g. `prod/` to share one bucket.

## Cloudflare R2

| In Cloudflare                                         | Setting                                                                         | Credentials                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **R2 → Create bucket**                                | e.g. `skillpouch-blobs`, location automatic, no public access                   | `S3_BUCKET`                                                                      |
| **R2 → Overview → Account details**                   | S3 API URL `https://<account id>.r2.cloudflarestorage.com` (without the bucket) | `S3_ENDPOINT`                                                                    |
| **R2 → Manage API tokens → Create Account API token** | Permission **Object Read & Write**, only this bucket                            | `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` or `secrets/s3_secret_access_key` |

## Moving a running server to a bucket

The live API keeps using the volume until the last step, so users notice
nothing.

1. Add the four `S3_` settings to `env/api.env` (or the secret to
   `secrets/s3_secret_access_key`), **keep `BLOB_DRIVER=fs`**, and deploy,
   so the API container has the settings.
2. Copy the files:

   ```sh
   docker exec -e API_ROLE=copy-blobs -e BLOB_DRIVER=s3 <live api container> node dist/main.mjs
   ```

   `docker ps --filter name=api` shows the container. It logs
   `blobs copied` with counts.

3. Set `BLOB_DRIVER=s3` and deploy again.
4. Run step 2 once more. It copies only what was uploaded in between and
   skips the rest.

Keep the volume until you've checked a few pouches.

With a bucket, back it up with the provider's own tools or `rclone`:
`backup.sh` covers only the volume ([Backups](/self-hosting/backups/)).
