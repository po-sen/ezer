import {
  AuthorizationError,
  CimdFetchError,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { AccessControl } from "../ports/inbound/index.ts";
import { renderConsent } from "./render-consent.ts";
import { readConsentForm } from "./read-consent-form.ts";

function errorResponse(status: number) {
  return new Response(
    status >= 500
      ? "Authorization is unavailable. Try again later."
      : "Authorization was not completed. Start again from your client.",
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

export function createAuthorizationHttpHandler(
  issuer: string,
  access: AccessControl,
  oauth: OAuthHelpers,
  protocol: (request: Request, context: ExecutionContext) => Promise<Response>,
) {
  return async (
    request: Request,
    context: ExecutionContext,
  ): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const authorization = url.pathname === "/authorize";
    if (
      !authorization &&
      !url.pathname.startsWith("/oauth/") &&
      url.pathname !== "/.well-known/oauth-authorization-server"
    )
      return;
    if (url.origin !== issuer)
      return new Response("Not found", { status: 404 });
    try {
      if (!authorization) return await protocol(request, context);
      if (!["GET", "POST"].includes(request.method))
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, POST" },
        });
      if (
        request.method === "POST" &&
        (request.headers.get("Origin") !== issuer || url.search)
      )
        return errorResponse(403);
      const result = await access.authorize(
        request.headers.get("Cf-Access-Jwt-Assertion"),
      );
      if (!result.ok)
        return errorResponse(result.code === "UNAVAILABLE" ? 503 : 403);
      const { callerId, individualId } = result.individual;
      if (request.method === "GET") {
        const authorizationRequest = await oauth.parseAuthRequest(request);
        const details = await oauth.describeConsent(authorizationRequest);
        const consent = await oauth.beginConsent(authorizationRequest);
        consent.headers.set("Content-Type", "text/html; charset=utf-8");
        consent.headers.set("Referrer-Policy", "no-referrer");
        consent.headers.set(
          "Content-Security-Policy",
          "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        );
        consent.headers.set("X-Content-Type-Options", "nosniff");
        return new Response(
          renderConsent(details, consent.handle, callerId, individualId),
          { headers: consent.headers },
        );
      }
      const form = await readConsentForm(request);
      // Recheck the current caller/assignment on POST, including account switches.
      if (
        !form ||
        form.get("caller") !== callerId ||
        form.get("individual") !== individualId ||
        !["approve", "deny"].includes(form.get("decision") ?? "")
      )
        return errorResponse(400);
      const handle = form.get("handle") ?? "";
      if (form.get("decision") === "deny") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, {
        scope: form.getAll("scope"),
      });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: callerId,
        metadata: {},
        scope: approved.request.scope,
        props: { individualId },
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (error) {
      // Only the parser can redirect to a validated client. Never trust form URLs.
      if (
        request.method === "GET" &&
        error instanceof AuthorizationError &&
        error.redirectTo
      )
        return new Response(null, {
          status: 302,
          headers: { Location: error.redirectTo, "Cache-Control": "no-store" },
        });
      return errorResponse(
        error instanceof AuthorizationError || error instanceof CimdFetchError
          ? 400
          : 503,
      );
    }
  };
}
