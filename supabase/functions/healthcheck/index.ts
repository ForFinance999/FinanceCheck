import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.0";
import postgres from "npm:postgres@3.4.7";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "supabase-healthcheck";
const ALLOWED_REPOSITORY = "ForFinance999/FinanceCheck";
const ALLOWED_REF = "refs/heads/main";
const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);
const githubKeys = createRemoteJWKSet(
  new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`),
);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function authorize(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token");

  const { payload } = await jwtVerify(match[1], githubKeys, {
    issuer: GITHUB_OIDC_ISSUER,
    audience: GITHUB_OIDC_AUDIENCE,
    algorithms: ["RS256"],
  });

  if (payload.repository !== ALLOWED_REPOSITORY) {
    throw new Error("Repository is not allowed");
  }
  if (payload.ref !== ALLOWED_REF) {
    throw new Error("Git ref is not allowed");
  }
  if (!ALLOWED_EVENTS.has(String(payload.event_name ?? ""))) {
    throw new Error("Workflow event is not allowed");
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    await authorize(request);
  } catch (error) {
    console.warn("Health-check authorization rejected", error);
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!databaseUrl) {
    console.error("SUPABASE_DB_URL is unavailable");
    return json({ ok: false, error: "Health-check is not configured" }, 500);
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 2,
  });

  try {
    const result = await sql`select 1 as ok`;
    if (result[0]?.ok !== 1) throw new Error("Unexpected database response");

    return json({ ok: true, checked_at: new Date().toISOString() });
  } catch (error) {
    console.error("Database health-check failed", error);
    return json({ ok: false, error: "Database check failed" }, 503);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
