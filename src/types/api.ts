export interface CompleteSignupParams {
  sessionId: string;
  code: string;
  phoneNumberId: string;
  wabaId: string;
  businessId: string;
}

export interface CompleteSignupResult {
  sessionId: string;
  status: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  appSubscribed: boolean;
  phoneRegistered: boolean;
  webhookOverrideActive: boolean;
  message: string;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
}

export interface SessionDetail {
  id: string;
  organizationId: string | null;
  status: string;
  metaBusinessId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  assetsSavedAt: string | null;
  webhookReadyAt: string | null;
}

export interface ActivateWebhookResult {
  sessionId: string;
  status: string;
  wabaId: string;
  webhookOverrideUri: string;
  message: string;
}

export interface ReconcileResult {
  sessionId: string;
  status: string;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
  message: string;
}
