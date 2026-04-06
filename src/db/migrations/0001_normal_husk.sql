CREATE TABLE `onboarding_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`event_type` text NOT NULL,
	`meta_session_id` text,
	`current_step` text,
	`error_code` text,
	`error_message` text,
	`phone_number_id` text,
	`waba_id` text,
	`business_id` text,
	`raw_payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `onboarding_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
