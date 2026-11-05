# Automatic photo retention — PhotoMap (2026-11-05)

## Live behavior

- **Age:** Every photo (pending, approved, or rejected) becomes eligible for permanent removal 60 days after `photos.created_at`.
- **Storage pressure:** The **project-wide** Supabase Storage footprint is measured by summing `storage.objects.metadata.size` across all buckets. When this reaches or exceeds **70%** of the configured quota, photos are removed **oldest first** until usage falls below the threshold. Early removal (less than 60 days old) is possible.
- **Configured quota:** 1 GiB (1,073,741,824 bytes), corresponding to Supabase Free's 1 GB included Storage quota. Trigger = floor(1 GiB × 0.70) = **751,619,276 bytes**.
- **Schedule:** `cron.job` named `photomap_photo_cleanup_hourly`, expression `0 * * * *` (UTC, hourly).
- **Per-run limit:** 100 image records. If more images need cleanup, remaining images are processed in subsequent runs.
- **Deletion:** The Edge Function calls the official Supabase Storage API to remove each file, then removes the corresponding row from `public.photos`. Associated comments cascade-delete; user reports are retained with nullable `photo_id`.
- **Audit:** Results recorded in `public.photo_cleanup_runs` (service-only table).
- **Authentication:** A 256-bit random token is stored in Supabase Vault under `photomap_photo_cleanup_token`. The cron request sends it in a private header; the Edge Function hashes and compares against the digest held in the private `photo_cleanup_config`. Never commit or display the token.
- **Public disclosure:** `privacy.html`, `terms.html`, and the upload form explain automatic deletion.

## Monitoring

```sql
select jobid,jobname,schedule,active from cron.job
where jobname='photomap_photo_cleanup_hourly';

select started_at,status,deleted_count,aged_deleted,pressure_deleted,failure_count
from public.photo_cleanup_runs order by started_at desc limit 10;

select quota_bytes,threshold_fraction from public.photo_cleanup_config;
```

## After changing Supabase plan or storage capacity

**The quota is currently a configured value; it does not automatically detect billing-plan upgrades.** Check Supabase organization billing and update the private setting to the newly applicable bucket quota if needed:

```sql
update public.photo_cleanup_config
set quota_bytes = <new_quota_bytes>, updated_at = now()
where single_row = true;
```

The cleanup job is independent of ChatGPT Automations and runs in Supabase. The logic assumes storage usage is represented accurately in `storage.objects.metadata.size`, but billing usage is computed in GB-hours and may lag.

## Tests performed

- Verified installed `pg_cron` and `pg_net`.
- Dry-run request via `pg_net` with Supabase Vault credential returned HTTP 200 and no deletion candidates.
- Real request returned HTTP 200 (`completed`, `deleted:0`, `failed:0`).
- Verified job active with schedule `0 * * * *`.
- Verified audit run recorded.
- **A real deletion was not tested, to avoid losing user photos.** Test future expiry with a safe test photo only.
