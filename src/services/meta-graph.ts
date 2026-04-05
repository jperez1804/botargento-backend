import pino from "pino";
import { env } from "../config/env.js";
import type { MetaGraphApiError } from "../types/meta.js";
import { MetaApiError } from "../types/meta.js";

const logger = pino({ level: env.LOG_LEVEL });

export const GRAPH_BASE = `https://graph.facebook.com/${env.META_API_VERSION}`;

export async function graphFetch<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T | MetaGraphApiError;

  if (!response.ok) {
    const errorBody = body as MetaGraphApiError;
    if (errorBody.error) {
      logger.error(
        {
          code: errorBody.error.code,
          type: errorBody.error.type,
          fbtrace_id: errorBody.error.fbtrace_id,
        },
        `Meta Graph API error: ${errorBody.error.message}`
      );
      throw new MetaApiError(errorBody.error);
    }
    throw new Error(
      `Meta Graph API returned ${response.status}: ${response.statusText}`
    );
  }

  return body as T;
}
