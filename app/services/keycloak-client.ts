import axios from "axios";
import fs from "fs";
import https from "https";
import jwksRsa from "jwks-rsa";
import jwt from "jsonwebtoken";
import { logger } from "../logger";

// HTTPS agent for JWKS fetch. Use CA_FILE or NODE_EXTRA_CA_CERTS: path to PEM file
// containing the CA that signed the IAM/Keycloak server cert (not the server cert itself).
// Or set NODE_TLS_REJECT_UNAUTHORIZED=0 / INSECURE_SSL=true for dev to skip TLS verify.
function getJwksHttpsAgent(): https.Agent | undefined {
  const allowInsecure =
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    process.env.INSECURE_SSL === "true" ||
    process.env.INSECURE_HTTPS === "true";
  if (allowInsecure) {
    return new https.Agent({ rejectUnauthorized: false });
  }
  const caPath = process.env.CA_FILE || process.env.NODE_EXTRA_CA_CERTS;
  if (!caPath) return undefined;
  try {
    const ca = fs.readFileSync(caPath, "utf8");
    return new https.Agent({ ca, rejectUnauthorized: true });
  } catch (e) {
    logger.warn("JWKS: could not load CA file for TLS", { path: caPath, err: (e as Error).message });
    return undefined;
  }
}
const jwksRequestAgent = getJwksHttpsAgent();

// Environment variables for your Keycloak realms
const tokenIssuer1 = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`;
const tokenIssuer2 = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_INTERNAL_REALM}`;

// Map issuers to JWKS clients
const jwksClients: Record<string, jwksRsa.JwksClient> = {
  [tokenIssuer1]: jwksRsa({
    jwksUri: `${tokenIssuer1}/protocol/openid-connect/certs`,
    requestAgent: jwksRequestAgent,
  }),
  [tokenIssuer2]: jwksRsa({
    jwksUri: `${tokenIssuer2}/protocol/openid-connect/certs`,
    requestAgent: jwksRequestAgent,
  }),
};

/**
 * Online JWT verification using Keycloak /userinfo endpoint
 */
export const verifyJWTOnline = (token: string) => {
  const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/userinfo`;
  return axios.get(url, {
    headers: {
      Authorization: token,
    },
  });
};

/**
 * Offline JWT verification using JWKS
 */
export const verifyJWTOffline = (token: string) => {
  return new Promise((resolve, reject) => {
    // jwt.verify with a dynamic key callback
    jwt.verify(
      token,
      (header, callback) => getKey(token, header, callback),
      (err, decoded) => {
        if (err) logger.debug("JWT verify error", { err: err?.message });
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
};

/**
 * Fetch the signing key from the appropriate JWKS client
 */
function getKey(token: string, header: any, callback: (err: any, key?: string) => void) {
  // Decode token to get the issuer
  const decoded = jwt.decode(token, { complete: true }) as any;
  const issuer = decoded?.payload?.iss;

  if (!issuer) return callback(new Error("Token missing 'iss' claim"));

  const client = jwksClients[issuer];
  if (!client) return callback(new Error(`No JWKS client configured for issuer: ${issuer}`));

  client.getSigningKey(header.kid, (err, key) => {
    if (err) logger.debug("JWKS getSigningKey error", { err: err?.message });
    if (err) return callback(err);
    if (!key) return callback(new Error(`Signing key not found for kid: ${header.kid}`));
    // Return the public key string
    callback(null, key.getPublicKey());
  });
}
