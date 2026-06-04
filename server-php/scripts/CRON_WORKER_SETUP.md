# Cron/Worker Setup (MySQL EVENT Replacement)

These scripts replace:
- `DailyAcademicUpdate`
- `RealTimeAttendanceManager`

## New scripts
- `daily-academic-update.php` (one-shot status sync job; used as fallback)
- `realtime-attendance-manager.php` (one-shot realtime tick job)
- `academic-attendance-worker.php` (long-running worker, default 5s interval; runs realtime attendance every tick and academic status sync every 5 minutes)
- `disable-mysql-events.sql` (drop old MySQL events)

## Website-open auto-heal
An API endpoint is available at:

- `GET /server-php/index.php/api/worker-bootstrap/ping`

It checks the Windows task `<project-folder>_AcademicAttendanceWorker` and starts it if it is not running.
The frontend calls this endpoint once on app load, so opening the website can self-heal the worker.

## Linux cron examples
Run realtime every minute (cron minimum is 1 minute):

```bash
* * * * * /usr/bin/php /path/to/project/server-php/scripts/realtime-attendance-manager.php >> /path/to/logs/realtime.log 2>&1
5 0 * * * /usr/bin/php /path/to/project/server-php/scripts/daily-academic-update.php >> /path/to/logs/daily.log 2>&1
```

If you need true 5-second behavior, run the long worker using `systemd`/supervisor:

```bash
/usr/bin/php /path/to/project/server-php/scripts/academic-attendance-worker.php --interval=5
```

## Windows Task Scheduler
Use:

```powershell
powershell -ExecutionPolicy Bypass -File .\server-php\scripts\create_cron_worker_tasks.ps1
```

This creates:
- `<project-folder>_AcademicAttendanceWorker` (on startup, 5-second loop)
- `<project-folder>_DailyAcademicUpdate` (daily 00:05 fallback safety run)

## Disable MySQL EVENTS (recommended)
After scheduler/worker is active, run:

```sql
SOURCE server-php/scripts/disable-mysql-events.sql;
```
