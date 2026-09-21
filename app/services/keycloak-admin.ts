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

export async function findUsersByName(firstName: string, lastName: string) {
  const access_token = await getAdminAccessToken();
  const response = await axios.get(
    `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
    {
      headers: { Authorization: `Bearer ${access_token}` },
      params: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        exact: true,
        max: 20,
      },
    }
  );
  return Array.isArray(response.data) ? response.data : [];
};

export async function getUserById(userId: string) {
  const access_token = await getAdminAccessToken();
  const response = await axios.get(
    `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  return response.data;
}

export async function updateUserContact(
  userId: string,
  patch: { email?: string; phone?: string }
) {
  const user = await getUserById(userId);
  const attributes = { ...(user.attributes || {}) };
  if (patch.phone !== undefined) {
    attributes.phone_number = [patch.phone];
    attributes.verified_phone_number = ["true"];
  }
  const emailChanged =
    patch.email !== undefined &&
    String(patch.email).trim().toLowerCase() !== String(user.email ?? "").trim().toLowerCase();

  const access_token = await getAdminAccessToken();
  await axios.put(
    `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}`,
    {
      username: user.username,
      enabled: user.enabled,
      firstName: user.firstName,
      lastName: user.lastName,
      email: patch.email !== undefined ? patch.email : user.email,
      emailVerified: emailChanged ? false : user.emailVerified,
      attributes,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
    }
  );
}
