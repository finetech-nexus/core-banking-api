import express, { Express } from "express";
import dotenv from "dotenv";
import axios from "axios";
import { route as authRoute } from "./routes/auth";
import { route as accountRoute } from "./routes/account";
import { route as productRoute } from "./routes/product";
import { route as beneficiaryRoute } from "./routes/beneficiary";
import { route as transferRoute } from "./routes/transfer";
import { route as exchangeRoute } from "./routes/exchange";
import { route as statementRoute } from "./routes/statement";
import { route as agenciesRoute } from "./routes/agencies";
import { route as kycRoute } from "./routes/kyc";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { debugApiLogger } from "./middlewares/debugApiLogger";
import { logger } from "./logger";

const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("../openapi.json");

dotenv.config();

axios.interceptors.request.use(
  (config) => {
    logger.debug("Axios request", { method: config.method, url: config.url });
    return config;
  },
  (error) => {
    logger.error("Axios request error", { error: error?.message });
    return Promise.reject(error);
  }
);

axios.interceptors.response.use(
  (response) => {
    logger.debug("Axios response", { status: response.status, url: response.config?.url });
    return response;
  },
  (error) => {
    if (error.response) {
      logger.warn("Axios error response", {
        status: error.response.status,
        url: error.config?.url,
      });
    } else if (error.code === "ECONNABORTED") {
      logger.warn("Axios timeout", { message: error.message });
    } else {
      logger.error("Axios error", { message: error.message });
    }
    return Promise.reject(error);
  }
);

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// When DEBUG=true or LOG_LEVEL=debug: log API request/response input and output
app.use(debugApiLogger);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get("/health", (_req, res) => res.status(200).send("OK"));

app.use("/api/auth", authRoute);
app.use("/api/account", accountRoute);
app.use("/api/product", productRoute);
app.use("/api/beneficiary", beneficiaryRoute);
app.use("/api/transfer", transferRoute);
app.use("/api/exchange", exchangeRoute);
app.use("/api/statement", statementRoute);
app.use("/api/agencies", agenciesRoute);
app.use("/api/kyc", kycRoute);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  logger.info("Server running", { port, url: `http://localhost:${port}` });
  logger.info("Swagger UI at http://localhost:" + port + "/api-docs");
});
