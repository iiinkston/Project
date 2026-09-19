/**
 * Express / Nest controller sketch.
 * Route: POST /v1/printer/pair  (public, no Bearer)
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export function pairRouteHandler(pairFn: (pairCode: string) => Promise<unknown>) {
  return async (req: IncomingMessage & { body?: { pairCode?: string } }, res: ServerResponse) => {
    try {
      const pairCode = String(req.body?.pairCode || "").trim();
      const result = await pairFn(pairCode);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error
          ? Number((error as { status: number }).status)
          : 500;
      const message = error instanceof Error ? error.message : String(error);
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: false, error: message }));
    }
  };
}
