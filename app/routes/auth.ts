import { Router, Request, Response, response } from "express";
import { body, validationResult } from "express-validator";
import resetPasswordValidator from "../validators/reset-password-validator";
import { getAdminAccessToken, getUserByEmail } from "../services/keycloak-admin";
import axios from "axios";
import { keycloakProtect } from "../middlewares/keycloakProtect";
import jwt from "jsonwebtoken";
import emailValidator from "@validators/email-exist-validator";
import { onboardUser } from "../services/coreBankingProcessor";
import registrationValidator from "../validators/registration-validator";
import { logger } from "../logger";

const { registerValidator, verifyOtpEmailValidator, verifyOtpPhoneValidator } = registrationValidator;

export const route = Router();

/** Normalize nationality to string[] for Keycloak register (expects List<String>). */
function normalizeNationalityList(
  value: string | string[] | null | undefined
): string[] | undefined {
  if (value == null || value === "") return undefined;
  if (Array.isArray(value)) return value.filter((s) => s != null && String(s).trim() !== "");
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
* @swagger
* tags:
*   name: Auth
*   description: Authentication and user management
*/


route.post( "/registrations/phone_verify",
  verifyOtpPhoneValidator,
  async (request: Request, response: Response) => {
    try {
      const errors = validationResult(request);

      if (!errors.isEmpty()) {
        // Validation failed
       return response.status(400).json({ code : errors.array()[0].type ,  message : errors.array()[0].msg });
      }

      const { body } = request;

      const { phone_number, otp} = body;

      // create user in keycloak
      const token = await getAdminAccessToken();

      const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/registrations/phone-verify`;
      const result = await axios.post(
        url,
        {
          phone_number,
          otp
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.status(result.status).json(result.data)
    } catch (error: any) {
      if (error.response) {
          // Keycloak responded with an error (like 403)
          return response
            .status(error.response.status)
            .json({ message: error.response.data });
        } else {
          // Network or Axios error
          return response.status(500).json({ message: error.message });
        }
    }
  }
);

route.post( "/registrations/email_verify",
  verifyOtpEmailValidator,
  async (request: Request, response: Response) => {
    try {
      const errors = validationResult(request);

      if (!errors.isEmpty()) {
        // Validation failed
        return response.status(400).json({ code : errors.array()[0].type ,  message : errors.array()[0].msg });
      }

      const { body } = request;

      const { email, otp} = body;

      // create user in keycloak
      const token = await getAdminAccessToken();

      const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/registrations/email-verify`;
      const result = await axios.post(
        url,
        {
          email,
          otp
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.status(result.status).json(result.data)
    } catch (error: any) {
      if (error.response) {
        // Keycloak responded with an error (like 403)
        return response
          .status(error.response.status)
          .json({ message: error.response.data });
      } else {
        // Network or Axios error
        return response.status(500).json({ message: error.message });
      }
    }
  }
);

/**
* @swagger
* /register:
*   post:
*     summary: Register a new user in Keycloak
*     tags: [Auth]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - username
*               - email
*               - phone_number
*               - first_name
*               - last_name
*             properties:
*               first_name:
*                 type: string
*               last_name:
*                 type: string
*               email:
*                 type: string
*                 format: email
*               phone_number:
*                 type: string
*               address:
*                 type: string
*               postal_code:
*                 type: string
*               city:
*                 type: string
*               country:
*                 type: string
*     responses:
*       201:
*         description: User successfully created
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 msg:
*                   type: string
*                   example: success
*       400:
*         description: Validation errors
*       401:
*         description: Unauthorized
*       403:
*         description: Forbidden
*       500:
*         description: Server error
*/
//keycloak rest-api register
route.post( "/registrations/register",
  registerValidator,
  async (request: Request, response: Response) => {
    try {
      const errors = validationResult(request);

      if (!errors.isEmpty()) {
        // Validation failed
        return response.status(400).json({ code : errors.array()[0].type ,  message : errors.array()[0].msg });
      }

      const { body } = request;
      //TODO getOnly one KYC
      const { email, phone_number, first_name, last_name, gender, birthday, nationality, address, postalCode, city, country, kyc_eu, kyc_tn } = body;

      // Keycloak expects nationality as list of strings
      const registerBody = { ...body };
      registerBody.nationality = normalizeNationalityList(nationality) ?? [];

      // create user in keycloak
      const token = await getAdminAccessToken();

      const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/registrations/register`;
      const result = await axios.post(
        url,
        registerBody,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      logger.info("REGISTER success", { userId: result?.data?.id });
      // 2. Trigger onboarding in the background (fire-and-forget)
      /*(async () => {
        try {
          //TODO ADD other params!
          const params = {
            gender: gender,
            firstName: first_name,
            lastName: last_name,
            dob: birthday,
            phone: phone_number,
            email: email,
            nationality: nationality,
            externalId: result.data.id,
            officeId: Number(process.env.OFFICE_ID),
            address: address, 
            postalCode: postalCode,
            city: city, 
            country:country,
            //kyc: kyc_eu,
            savingsProductId: Number(process.env.DEFAULT_SAVING_PRODUCT),
          };
          logger.info("Background onboardUser", { userId: result.data.id });
          await onboardUser(params);
          //3. Activate user kc, if error onbarding, user is still disabled
          // const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/registrations/register`;
          logger.warn("Optional: notify support / update status in DB");
        } catch (error: any) {
          if (error.response) {
            logger.warn("Optional: notify support / update status in DB");
            logger.error("Background onboarding failed", { data: error.response?.data });
          } else {
            logger.warn("Optional: notify support / update status in DB");
            logger.error("Background onboarding error", { message: error.message });
          }
        }
      })();*/

      // 3. Immediately return success from Keycloak
      return response.status(result.status).json(result.data);

      
       
    } catch (error: any) {
         if (error.response) {
           // Keycloak responded with an error (like 403)
           return response
             .status(error.response.status)
             .json({ message: error.response.data });
         } else {
           // Network or Axios error
           return response.status(500).json({ message: error.message });
         }
    }
  }
);


/**
* @swagger
* /login:
*   post:
*     summary: Login user via Keycloak and obtain tokens
*     tags: [Auth]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - email
*               - password
*             properties:
*               email:
*                 type: string
*                 format: email
*               password:
*                 type: string
*     responses:
*       200:
*         description: Login successful, returns tokens
*         content:
*           application/json:
*             schema:
*               type: object
*               example:
*                 access_token: "eyJhbGciOiJIUzI1NiIsInR..."
*                 refresh_token: "eyJhbGciOiJIUzI1NiIsInR..."
*       401:
*         description: Invalid credentials
*       500:
*         description: Server error
*/
//keycloak rest-api login
route.post("/login",verifyOtpPhoneValidator, async (request: Request, response: Response) => {
    try {
      const errors = validationResult(request);
      if (!errors.isEmpty()) {
        // Validation failed
       return response.status(400).json({ code : errors.array()[0].type ,  message : errors.array()[0].msg });
      }
      const { body } = request;
      const { phone_number, otp} = body;

      const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`;
      const kc_response = await axios.post( url,
          {
            grant_type: "password",
            client_id: process.env.KEYCLOAK_CLIENT_ID ?? "",
            client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
            phone_number: phone_number,
            otp: otp,
          },
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      return response.json(kc_response.data).status(200);
      } catch (error: any) {
         if (error.response) {
           // Keycloak responded with an error (like 403)
           return response
             .status(error.response.status)
             .json({ message: error.response.data });
         } else {
           // Network or Axios error
           return response.status(500).json({ message: error.message });
          }
      }
});
/**
* @swagger
* /token:
*   post:
*     summary: Refresh JWT access token using refresh token
*     tags: [Auth]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - refresh_token
*             properties:
*               refresh_token:
*                 type: string
*     responses:
*       200:
*         description: New token issued
*       403:
*         description: Refresh token missing or invalid
*       500:
*         description: Server error
*/
// get token using refresh token
route.post("/token", async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: errors.array()[0].type, message: errors.array()[0].msg });
    }


    

    const { subject_token } = req.body;

    const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append("grant_type", "urn:ietf:params:oauth:grant-type:token-exchange");
    params.append("subject_token_type", "urn:ietf:params:oauth:token-type:access_token");
    params.append("subject_issuer", process.env.SUBJECT_ISSUER ?? "");
    params.append("client_id", process.env.KEYCLOAK_CLIENT_ID ?? "");
    params.append("client_secret", process.env.KEYCLOAK_CLIENT_SECRET ?? "");
    params.append("subject_token", subject_token);


    logger.debug("Keycloak subject token exchange requested", {
      subjectIssuer: process.env.SUBJECT_ISSUER,
    });
    const kc_response = await axios.post(url, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return res.status(200).json(kc_response.data);
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response) {
      return res.status(error.response.status).json({ message: error.response.data });
    }
    return res.status(500).json({ message: error.message });
  }
});
/*route.post("/login", async (request: Request, response: Response) => {
  const { email, password } = request.body;
  const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`;

  try {
    const kc_response = await axios.post(
      url,
      {
        grant_type: "password",
        client_id: process.env.KEYCLOAK_CLIENT_ID ?? "",
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
        username: email,
        password: password,
      },
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    return response.json(kc_response.data).status(200);
  } catch (error: any) {
    if (error?.response?.status === 401) {
      return response.status(401).json({ message: "invalid credentials" });
    }
    return response.status(500).json({ error });
  }
});
*/
/**
* @swagger
* /logout:
*   post:
*     summary: Logout user and revoke tokens
*     tags: [Auth]
*     security:
*       - bearerAuth: []
*     responses:
*       204:
*         description: Successfully logged out
*       401:
*         description: Unauthorized
*       500:
*         description: Server error
*/
// keycloak rest-api logout
route.post( "/logout",
  keycloakProtect,
  async (request: any, response: Response, next) => {
    const userInfo = request.userInfo;
    try {
      const accessToken = (await getAdminAccessToken()) ?? "";

      const revokeTokenUrl = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userInfo.sub}/logout`;
      const res = await axios.post(revokeTokenUrl, null, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (res.status === 204) {
        // Successful logout
        return response.sendStatus(204);
      } else {
        // Error occurred during logout
        return response.status(res.status).json(res.data);
      }
    } catch (error : any) {
      if (error.response) {
        // Keycloak responded with an error (like 403)
        return response
          .status(error.response.status)
          .json({ message: error.response.data });
      } else {
        // Network or Axios error
        return response.status(500).json({ message: error.message });
      }
    }
  }
);

// keycloak backend channel logout

route.post("/logout-event", (req, res) => {
  return res.status(200).json({ status: 200 });
});


/**
* @swagger
* /set-password:
*   post:
*     summary: Update user password (protected)
*     tags: [Auth]
*     security:
*       - bearerAuth: []
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - password
*             properties:
*               password:
*                 type: string
*     responses:
*       200:
*         description: Password updated successfully
*       401:
*         description: Unauthorized
*       500:
*         description: Server error
*/
// update password
route.post(
  "/set-password",
  keycloakProtect,
  async (request: any, response: Response) => {
    const { password } = request.body;
    const userInfo: any = request?.userInfo;

    const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userInfo.id}`;

    const token = await getAdminAccessToken();

    await axios.put(
      url,
      {
        enabled: true,
        credentials: [
          {
            type: "password",
            value: password,
            temporary: false,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.json({ status: 200 }).status(200);
  }
);


/**
* @swagger
* /forgot-password:
*   post:
*     summary: Request password reset email
*     tags: [Auth]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - email
*             properties:
*               email:
*                 type: string
*                 format: email
*     responses:
*       200:
*         description: Reset email sent
*       400:
*         description: Invalid request
*       500:
*         description: Server error
*/
// forgot password
route.post("/forgot-password", (request: Request, response: Response) => {
  try {
    const expiresInHours = 24;
    const secretKey = "your_secret_key";
    const email = request.body;
    // check if email exist
    const token = jwt.sign({ email }, secretKey, {
      expiresIn: expiresInHours * 60 * 60,
    });

    const url = `${process.env.FRONTEND_URL}?token=${token}`;

    return response.json({ status: 200 }).status(200);
  } catch (error) {
    return response.json({ status: 500 }).status(400);
  }
});

/**
* @swagger
* /set-password:
*   put:
*     summary: Reset password using token
*     tags: [Auth]
*     parameters:
*       - in: query
*         name: token
*         schema:
*           type: string
*         required: true
*         description: Password reset token
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - password
*             properties:
*               password:
*                 type: string
*     responses:
*       200:
*         description: Password reset successfully
*       400:
*         description: Validation error or token missing/invalid
*       500:
*         description: Server error
*/
// set new password
route.put(
  "/set-password",
  resetPasswordValidator,
  async (request: any, response: Response) => {
    try {
      const { password } = request.body;
      const token: any = request?.query.token;
      const secretKey = "your_secret_key";
      const decoded: any = jwt.verify(token, secretKey);
      const email = decoded?.email;
      const userId = await getUserByEmail(email);
      const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}`;

      const access_token = await getAdminAccessToken();

      await axios.put(
        url,
        {
          enabled: true,
          credentials: [
            {
              type: "password",
              value: password,
              temporary: false,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access_token}`,
          },
        }
      );
      return response.json({ status: 200 }).status(200);
    } catch (error : any) {
      if (error.response) {
        // Keycloak responded with an error (like 403)
        return response
          .status(error.response.status)
          .json({ message: error.response.data });
      } else {
        // Network or Axios error
        return response.status(500).json({ message: error.message });
      }
    }
  }
);
/**
* @swagger
* /verify-email:
*   get:
*     summary: Verify user email via token
*     tags: [Auth]
*     parameters:
*       - in: query
*         name: token
*         schema:
*           type: string
*         required: true
*         description: Email verification token
*     responses:
*       200:
*         description: Email verified successfully
*       403:
*         description: Token missing or invalid
*       500:
*         description: Server error
*/
// verify email
route.get("/verify-email", async (request: Request, response) => {
  const token = request.query.token;

  if (token) {
    return response.json({ status: 403, message: "token missing" }).status(403);
  }

  const userId = "";
  // token verification
  try {
    const accessToken = await getAdminAccessToken();

    await axios.put(
      `${process.env.KEYCLOAK_URL}/auth/admin/realms/{realm}/users/${userId}`,
      {
        emailVerified: true,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return response.json({ status: 200 }).status(200);
  } catch (error) {
    return response.json({ status: 500 }).status(500);
  }
});




/**
* @swagger
* /login/magiclink:
*   post:
*     summary: Send login magic link via email
*     tags: [Auth]
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - email
*             properties:
*               email:
*                 type: string
*                 format: email
*     responses:
*       200:
*         description: Magic link email sent successfully
*       500:
*         description: Failed to send magic link email
*/
route.post('/login/magiclink',emailValidator ,async (request:Request, response:Response) => {
  try {
    const email = request.body.email;



    const kcresponse = await axios.post(
      `${process.env.KEYCLOAK_URL}/auth/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      null,
      {
        params: {
          grant_type: 'password',
          client_id: process.env.KEYCLOAK_CLIENT_ID,
          username: email,
          password: 'magic-link',
        },
      }
    );

    // Check the response status and send the magic link via email
    if (kcresponse.status === 200) {
      const accessToken = kcresponse.data.access_token;

     const url =  `${process.env.FRONTEND_APP_URL}/login/magiclink?token=${accessToken}`;
      // send  email


    } else {
      return response.status(500).json({ error: 'Failed to send magic link email' });
    }
  } catch (error) {
    logger.error("Auth route error", { error });
    return response.status(500).json({ error: 'Failed to send magic link email' });
  }
});


