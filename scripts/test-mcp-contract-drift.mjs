// Offline unit tests for tool-definition drift and the MCP server's own tools/list.
import assert from "node:assert/strict";
import { canonical, compareTools, digest, manifest, sourceToolsList } from "./mcp-contract-drift.mjs";

const tool = (name, description="original") => ({
  name, title:name, description, inputSchema:{required:[],type:"object",properties:{x:{description:"An argument",type:"string"}}},
  annotations:{readOnlyHint:true}
});
const a = tool("alpha"), b = tool("beta");
assert.deepEqual(canonical({z:1,a:{d:2,b:3}}),{a:{b:3,d:2},z:1});
assert.equal(digest([a,b]),digest([JSON.parse(JSON.stringify(a)),b]));
assert.equal(digest(manifest([a,b])),digest(manifest([b,a])),"tool listing order is not semantic drift");
assert.deepEqual(compareTools([a,b],[b,a]).changed,[]);
assert.equal(compareTools([a,b],[b,a]).equal,true);
const schemaChanged = {...a,inputSchema:{...a.inputSchema,required:["x"]}};
const diff = compareTools([schemaChanged,tool("gamma")],[a,b]);
assert.deepEqual(diff.added,["gamma"]);
assert.deepEqual(diff.removed,["beta"]);
assert.deepEqual(diff.changed,[{name:"alpha",fields:["inputSchema"]}]);
assert.equal(diff.equal,false);
assert.deepEqual(compareTools([tool("alpha","new description")],[a]).changed,
  [{name:"alpha",fields:["description"]}]);
assert.throws(()=>manifest([a,a]),/duplicate MCP tool/);
assert.throws(()=>manifest({}),/tools array/);
const declared = await sourceToolsList();
assert.ok(declared.length >= 18,"actual MCP server exposes the current tool definitions");
assert.ok(declared.some(t=>t.name==="belgian_statistics"));
console.log("MCP contract-drift tests passed (" + declared.length + " tools)");
