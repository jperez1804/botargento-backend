CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`credential_type` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`scopes` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	`rotated_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meta_business_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`meta_business_id` text NOT NULL,
	`business_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meta_business_accounts_meta_business_id_unique` ON `meta_business_accounts` (`meta_business_id`);--> statement-breakpoint
CREATE TABLE `onboarding_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`status` text NOT NULL,
	`meta_business_id` text,
	`waba_id` text,
	`phone_number_id` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`assets_saved_at` text,
	`webhook_ready_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_email` text,
	`tenant_subdomain` text,
	`tenant_webhook_url` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `phone_numbers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`waba_id` text NOT NULL,
	`phone_number_id` text NOT NULL,
	`display_phone_number` text,
	`registered` integer DEFAULT false NOT NULL,
	`registration_pin` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`waba_id`) REFERENCES `whatsapp_business_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phone_numbers_phone_number_id_unique` ON `phone_numbers` (`phone_number_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`payload` text NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_idempotency_key_unique` ON `webhook_events` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `whatsapp_business_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`meta_business_account_id` text NOT NULL,
	`waba_id` text NOT NULL,
	`app_subscribed` integer DEFAULT false NOT NULL,
	`webhook_override_active` integer DEFAULT false NOT NULL,
	`webhook_override_uri` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`meta_business_account_id`) REFERENCES `meta_business_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_business_accounts_waba_id_unique` ON `whatsapp_business_accounts` (`waba_id`);