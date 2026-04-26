import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { httpLogSerializers } from "./lib/log-serializers";

const app: Express = express();

// Trust the upstream proxy (Replit edge / any CDN in front) so that
// `req.protocol` and `req.get("host")` reflect what the client actually
// targeted. NIP-98 binds the auth event to the absolute request URL, so
// these must match what the client signed.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: httpLogSerializers,
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
