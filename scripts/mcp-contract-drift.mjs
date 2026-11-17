// Compare MCP tool declarations in this source revision with the deployed endpoint.
// No MCP tool is called. Public tools/list metadata only, no credentials, no writes.
// Before deployment: report intended additions/removals/schema changes.
// After deployment: --strict makes unexplained differences fail the release verification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { handleMcp } from "../mcp-server.mjs";

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const serial = value => JSON.stringify(canonical(value));
export function digest(value) {
  return createHash("sha256").update(serial(value)).digest("hex");
}
export function manifest(tools) {
  assert.ok(Array.isArray(tools), "tools/list must return a tools array");
  const names = new Set();
  return tools.map(tool => {
    assert.ok(tool && typeof tool.name === "string" && tool.name, "each tool needs a name");
    assert.ok(!names.has(tool.name), "duplicate MCP tool: " + tool.name);
    names.add(tool.name);
    return canonical(tool);
  }).sort((a,b) => a.name.localeCompare(b.name));
}
const PROPERTIES = ["title", "description", "inputSchema", "annotations", "outputSchema", "_meta"];
export function compareTools(sourceTools, liveTools) {
  const source = manifest(sourceTools), live = manifest(liveTools);
  const s = new Map(source.map(t => [t.name,t])), l = new Map(live.map(t => [t.name,t]));
  const added = source.filter(t => !l.has(t.name)).map(t => t.name);
  const removed = live.filter(t => !s.has(t.name)).map(t => t.name);
  const changed = source.filter(t => l.has(t.name) && serial(t) !== serial(l.get(t.name))).map(t => ({
    name: t.name,
    fields: [...new Set([...PROPERTIES, ...Object.keys(t), ...Object.keys(l.get(t.name))])]
      .filter(k => k !== "name" && serial(t[k] ?? null) !== serial(l.get(t.name)[k] ?? null)),
  }));
  return { source: digest(source), live: digest(live), sourceCount: source.length, liveCount: live.length,
    added, removed, changed, equal: !added.length && !removed.length && !changed.length };
}
export async function sourceToolsList() {
  const req = new Request("https://contract-check.invalid/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})
  });
  const response = await handleMcp(req, {}, {});
  assert.equal(response.status, 200, "local tools/list must succeed");
  const data = await response.json();
  return manifest(data?.result?.tools);
}
export async function liveToolsList(origin, fetchImpl=fetch) {
  const root = new URL(origin);
  if (root.protocol !== "https:" && !(root.protocol === "http:" && ["localhost","127.0.0.1"].includes(root.hostname))) {
    throw new Error("origin must use HTTPS (or HTTP on localhost)");
  }
  const url = new URL("/mcp", root);
  const request = {jsonrpc:"2.0",id:1,method:"tools/list"};
  const response = await fetchImpl(url, {
    method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
    headers:{"content-type":"application/json",accept:"application/json, text/event-stream",
      "mcp-protocol-version":"2025-06-18"},body:JSON.stringify(request)
  });
  if (!response.ok) throw new Error("live tools/list returned HTTP " + response.status);
  const body = await response.text();
  if (body.length > 1024*1024) throw new Error("tools/list exceeded 1 MiB");
  let data;
  if ((response.headers.get("content-type") || "").includes("event-stream")) {
    data = body.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => JSON.parse(line.slice(5))).find(item => item.id === 1);
  } else {
    data = JSON.parse(body);
  }
  if (data?.error) throw new Error("live tools/list error: " + JSON.stringify(data.error));
  return manifest(data?.result?.tools);
}
function printDifference(result) {
  console.log("Source: " + result.sourceCount + " tools, SHA-256 " + result.source);
  console.log("Live:   " + result.liveCount + " tools, SHA-256 " + result.live);
  if (result.equal) return console.log("PASS tool declarations match exactly");
  for (const name of result.added) console.log("SOURCE ADDS " + name);
  for (const name of result.removed) console.log("LIVE ONLY   " + name);
  for (const item of result.changed) console.log("CHANGED     " + item.name + ": " + item.fields.join(", "));
}
async function main() {
  const args = process.argv.slice(2), strict = args.includes("--strict");
  const at = args.indexOf("--origin");
  if (at >= 0 && !args[at+1]) throw new Error("--origin requires a URL");
  const origin = at < 0 ? "https://data.vecture.be" : args[at+1];
  const atAttempts = args.indexOf("--attempts");
  const attempts = atAttempts < 0 ? 1 : Number(args[atAttempts+1]);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error("--attempts must be 1-5");
  const source = await sourceToolsList();
  for (let i=1;i<=attempts;i++) {
    try {
      const live = await liveToolsList(origin);
      const result = compareTools(source,live);
      console.log("MCP contract comparison (" + origin + "), attempt " + i + "/" + attempts);
      printDifference(result);
      if (result.equal || !strict) return;
    } catch (error) {
      console.error("MCP contract check attempt " + i + ": " + error.message);
      if (!strict && i === attempts) throw error;
    }
    if (i < attempts) await new Promise(resolve=>setTimeout(resolve,3000));
  }
  process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL("file://" + process.argv[1]))) {
  main().catch(error => { console.error("MCP contract check: " + error.message); process.exitCode = 1; });
}
