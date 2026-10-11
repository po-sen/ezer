import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

const labels: Record<string, string> = {
  "ezer:connect": "Connect to this Ezer and view its identity",
  "ezer:memory:read": "Read this Ezer's memories and history",
  "ezer:memory:write": "Create and correct this Ezer's memories",
  offline_access: "Stay connected for up to seven days",
};

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

export function renderConsent(
  details: ConsentDescription,
  handle: string,
  callerId: string,
  individualId: string,
) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Connect to Ezer</title>
<main><h1>Connect ${escape(details.clientName)} to Ezer?</h1>
<p>Ezer: <strong>${escape(individualId)}</strong></p>
<p>${details.clientDomain ? `Client domain: <strong>${escape(details.clientDomain)}</strong>` : "This client's name is self-reported and has not been verified."}</p>
<p>Access will be returned to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This connects an app on your computer. Continue only if you just started signing in from that app.</strong></p>" : ""}
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escape(handle)}">
<input type="hidden" name="caller" value="${escape(callerId)}">
<input type="hidden" name="individual" value="${escape(individualId)}">
<fieldset><legend>Allow this client to:</legend>
${details.scope.map((scope) => `<p><label><input type="checkbox" name="scope" value="${escape(scope)}" checked> ${escape(labels[scope] ?? scope)}</label></p>`).join("")}
</fieldset>
<p>You can remove permissions above. Without connection permission, the client cannot use this Ezer.</p>
<button name="decision" value="approve">Allow</button>
<button name="decision" value="deny">Deny</button>
</form></main></html>`;
}
