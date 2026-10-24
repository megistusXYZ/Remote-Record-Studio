import { Router, type IRouter } from "express";
import { GetIceServersResponse } from "@workspace/api-zod";
import {
  getAuthPubkey,
  requireSignedRequest,
} from "../middlewares/require-signed-request";
import { buildIceServers } from "../lib/turn-credentials";

const router: IRouter = Router();

/**
 * ICE servers for the live preview. Signed, so credentials are only handed
 * to people who hold a studio or guest key, and each credential is tied to
 * the caller and a short lifetime.
 */
router.get("/turn", requireSignedRequest(), (req, res) => {
  const pubkey = getAuthPubkey(req) ?? "anonymous";
  const result = buildIceServers(pubkey, {
    TURN_URLS: process.env["TURN_URLS"],
    TURN_SHARED_SECRET: process.env["TURN_SHARED_SECRET"],
    TURN_TTL_SECONDS: process.env["TURN_TTL_SECONDS"],
    STUN_URLS: process.env["STUN_URLS"],
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(GetIceServersResponse.parse(result));
});

export default router;
