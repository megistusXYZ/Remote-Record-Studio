import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sessionsRouter from "./sessions";
import recordingsRouter from "./recordings";
import vaultRouter from "./vault";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sessionsRouter);
router.use(recordingsRouter);
router.use(vaultRouter);

export default router;
