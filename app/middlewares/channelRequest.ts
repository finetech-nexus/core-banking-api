import axios, { Method } from 'axios';


interface MakeRequestOptions {
  method: Method;
  endpoint: string;
  data?: Record<string, any> | null;
  auth?: string | null;
  tenant?: string;
  headers?: Record<string, string>;
}
  const DEFAULT_TENANT = process.env.FINERACT_TENANT || "default";
// API Request Helper
export async function channelRequest<T = any>({
  method,
  endpoint,
  data = null,
  auth = null,
  tenant = DEFAULT_TENANT,
  headers: extraHeaders = {}
}: MakeRequestOptions): Promise<T | { error: boolean; status: number; message: any }> {
  const BASE_URL = process.env.CHANNEL_BASE_URL || "https://channel.mifos.gazelle.test";
  const DEFAULT_TENANT = process.env.FINERACT_TENANT || "default";
  const API_BASE_PATH = process.env.CHANNEL_BASE_PATH || "";
  const url = `${BASE_URL}${API_BASE_PATH}${endpoint}`;

  const headers: Record<string, string> = {
    'Platform-TenantId': tenant,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (auth) {
    headers['Authorization'] = auth;
  }

  try {
    const response = await axios({
      method,
      url,
      headers,
      data,
    });

    return response.data;
  } catch (error: any) {
    return {
      error: true,
      status: error.response?.status || 500,
      message: error.response?.data || error.message,
    };
  }
}