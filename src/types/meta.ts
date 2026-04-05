// ─── Token Exchange ──────────────────────────────────────────────────────────
// GET /oauth/access_token response
export interface MetaTokenExchangeResponse {
  access_token: string;
  token_type: string;
}

export interface TokenExchangeResult {
  accessToken: string;
  tokenType: string;
}

// ─── Debug Token ─────────────────────────────────────────────────────────────
// GET /debug_token response
export interface MetaDebugTokenResponse {
  data: {
    app_id: string;
    type: string;
    application: string;
    is_valid: boolean;
    scopes: string[];
    granular_scopes?: Array<{
      scope: string;
      target_ids?: string[];
    }>;
    expires_at: number;
    data_access_expires_at: number;
    user_id?: string;
  };
}

export interface DebugTokenResult {
  appId: string;
  isValid: boolean;
  scopes: string[];
  granularScopes: Array<{
    scope: string;
    targetIds?: string[];
  }>;
  expiresAt: number;
  dataAccessExpiresAt: number;
}

// ─── Subscribe App ───────────────────────────────────────────────────────────
// POST /{waba_id}/subscribed_apps response
export interface MetaSubscribeAppResponse {
  success: boolean;
}

// ─── Register Phone ──────────────────────────────────────────────────────────
// POST /{phone_number_id}/register response
export interface MetaRegisterPhoneResponse {
  success: boolean;
}

// ─── Graph API Error ─────────────────────────────────────────────────────────
export interface MetaGraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export class MetaApiError extends Error {
  readonly code: number;
  readonly type: string;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;

  constructor(error: MetaGraphApiError["error"]) {
    super(error.message);
    this.name = "MetaApiError";
    this.code = error.code;
    this.type = error.type;
    this.errorSubcode = error.error_subcode;
    this.fbtraceId = error.fbtrace_id;
  }
}
