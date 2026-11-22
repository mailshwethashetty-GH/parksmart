-- Offers now reference the request, not the waitlist row (the queue changes; offers are
-- history). Generated in two steps by drizzle-kit; combined here because SQLite cannot
-- ADD a NOT NULL foreign-key column. Existing offers keep their request via the old row.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`bay_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bay_id`) REFERENCES `bays`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_offers`("id", "request_id", "bay_id", "expires_at", "status", "created_at")
SELECT o."id", w."request_id", o."bay_id", o."expires_at", o."status", o."created_at"
FROM `offers` o JOIN `waitlist` w ON w."id" = o."waitlist_id";--> statement-breakpoint
DROP TABLE `offers`;--> statement-breakpoint
ALTER TABLE `__new_offers` RENAME TO `offers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `offers_status_expires_idx` ON `offers` (`status`,`expires_at`);
