-- request_id itself is added by 0002 (see the note there).
CREATE INDEX `offers_request_idx` ON `offers` (`request_id`);
