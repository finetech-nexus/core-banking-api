import axios from "axios";
import { cache } from "./cache";
import { logger } from "../logger";

export const getAdminAccessToken = async () => {
  let token = cache.get("access_token");
  if (!token) {
    const body = {
      grant_type: "client_credentials",
      client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "",
      client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? "",
    };
    const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`;
    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    token = response.data.access_token;
    cache.set("access_token", token, 60 * 5);
  }
  return token;
};

export const getGlobalAdminAccessToken = async () => {
  let token = cache.get("access_token_global");
  if (!token) {
    const body = {
      grant_type: "client_credentials",
      client_id: process.env.GLOBAL_KEYCLOAK_CLIENT_ID ?? "",
      client_secret: process.env.GLOBAL_KEYCLOAK_CLIENT_SECRET ?? "",
    };
    const url = `${process.env.GLOBAL_KEYCLOAK_URL}/realms/${process.env.GLOBAL_KEYCLOAK_REALM}/protocol/openid-connect/token`;
    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    token = response.data.access_token;
    cache.set("access_token_global", token, 60 * 5);
  }
  return token;
};

export const getFineractAccessToken = async () => {
  let token = cache.get("access_token_fineract");
  if (!token) {
    const body = {
      grant_type: "password",
      client_id: process.env.KEYCLOAK_FINERACT_CLIENT_ID ?? "",
      client_secret: process.env.KEYCLOAK_FINERACT_CLIENT_SECRET ?? "",
      username: process.env.KEYCLOAK_FINERACT_USERNAME ?? "",
      password: process.env.KEYCLOAK_FINERACT_PASSWORD ?? "",
    };
    const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_INTERNAL_REALM}/protocol/openid-connect/token`;
    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    token = response.data.access_token;
    cache.set("access_token_fineract", token, 60 * 5);
  }
  return token;
};

export const getUserByEmail = async (email: string) => {
  try {
    const access_token = await getAdminAccessToken();

    const response = await axios.get(
      `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users?email=${email}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );
    const users = response.data;
    if (users.length > 0) {
      const userId = users[0].id;
      return userId;
    }
    return null; // User not found
  } catch (error) {
    logger.error("Error retrieving user", { error });
    throw error;
  }
};
