ALTER TABLE `onboarding_sessions` ADD `signup_type` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `signup_type` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `contacts_sync_requested_at` text;--> statement-breakpoint
ALTER TABLE `phone_numbers` ADD `history_sync_requested_at` text;