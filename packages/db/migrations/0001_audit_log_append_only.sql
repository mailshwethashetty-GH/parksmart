-- Non-negotiable #5: audit_log is append-only.
-- UPDATE is always blocked. DELETE is only allowed for rows older than 12 months,
-- which is what the audit-retention job removes. `at` is epoch milliseconds (UTC).
CREATE TRIGGER `audit_log_no_update`
BEFORE UPDATE ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete_within_retention`
BEFORE DELETE ON `audit_log`
WHEN OLD.`at` > (CAST(strftime('%s', 'now', '-12 months') AS INTEGER) * 1000)
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows are kept for 12 months');
END;
