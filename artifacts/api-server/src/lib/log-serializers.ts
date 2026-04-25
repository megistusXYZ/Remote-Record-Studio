import type { IncomingMessage, ServerResponse } from "node:http";

type PinoHttpReq = IncomingMessage & { id?: string | number };

export function reqSerializer(req: PinoHttpReq) {
  return {
    id: req.id,
    method: req.method,
    url: req.url?.split("?")[0],
  };
}

export function resSerializer(res: ServerResponse) {
  return {
    statusCode: res.statusCode,
  };
}

export const httpLogSerializers = {
  req: reqSerializer,
  res: resSerializer,
};
