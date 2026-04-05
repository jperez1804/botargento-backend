import pino from "pino";
import { env } from "../config/env.js";
import type {
  MetaTokenExchangeResponse,
  MetaDebugTokenResponse,
  TokenExchangeResult,
  DebugTokenResult,
} from "../types/meta.js";
import { graphFetch, GRAPH_BASE } from "./meta-graph.js";

const logger = pino({ level: env.LOG_LEVEL });

/**
 * Exchange an authorization code for an access token.
 * GET /oauth/access_token?client_id=&client_secret=&code=
 */
export async function exchangeCodeForToken(
  code: string
): Promise<TokenExchangeResult> {
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("client_secret", env.META_APP_SECRET);
  url.searchParams.set("code", code);

  logger.info("Exchanging authorization code for token");

  const data = await graphFetch<MetaTokenExchangeResponse>(url.toString());

  logger.info("Token exchange successful");

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
  };
}

/**
 * Debug/inspect a token to verify scopes and validity.
 * GET /debug_token?input_token= with system user bearer token.
 */
export async function debugToken(
  inputToken: string
): Promise<DebugTokenResult> {
  const url = new URL(`${GRAPH_BASE}/debug_token`);
  url.searchParams.set("input_token", inputToken);

  logger.info("Debugging token");

  const data = await graphFetch<MetaDebugTokenResponse>(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.META_SYSTEM_USER_TOKEN}`,
    },
  });

  logger.info(
    { isValid: data.data.is_valid, scopes: data.data.scopes },
    "Token debug complete"
  );

  return {
    appId: data.data.app_id,
    isValid: data.data.is_valid,
    scopes: data.data.scopes,
    granularScopes: (data.data.granular_scopes ?? []).map((gs) => ({
      scope: gs.scope,
      targetIds: gs.target_ids,
    })),
    expiresAt: data.data.expires_at,
    dataAccessExpiresAt: data.data.data_access_expires_at,
  };
}
