import assert from "node:assert/strict";
import { cleanReadOnlySql, safeRemoteHttpUrl, safeCsvCellValue } from "../public/sql-lab-v1.mjs";

const ok=[
  "SELECT 42 AS answer",
  "WITH x AS (SELECT 1 AS id) SELECT * FROM x",
  "SELECT ';' AS literal_semicolon",
  "SELECT 'read_csv(https://evil.example)' AS harmless_text",
  "SELECT * FROM \"read_csv\"",
  "SELECT query_table('loaded_table')",
  "/* comment */ SELECT 1 -- tail"
];
for(const sql of ok)assert.doesNotThrow(()=>cleanReadOnlySql(sql),sql);

const blocked=[
  ["SHOW TABLES","SELECT / WITH only"],
  ["DESCRIBE SELECT 1","SELECT / WITH only"],
  ["SELECT 1; SELECT 2","one statement"],
  ["SELECT * FROM read_csv_auto('https://evil.example/a.csv')","read_csv"],
  ["SELECT * FROM read_csv_auto/**/('https://evil.example/a.csv')","comment-obfuscated reader"],
  ["SELECT * FROM read_parquet('https://evil.example/a.parquet')","parquet reader"],
  ["SELECT * FROM read_blob('local_1.csv')","blob reader"],
  ["SELECT * FROM read_text('local_1.csv')","text reader"],
  ["SELECT * FROM read_json_objects('https://evil.example/a.json')","reader family"],
  ["SELECT * FROM parquet_metadata('https://evil.example/a.parquet')","parquet metadata reader"],
  ["SELECT * FROM sniff_csv('https://evil.example/a.csv')","CSV sniffer"],
  ["SELECT * FROM postgres_scan('host=evil','public','t')","scanner family"],
  ["SELECT * FROM duckdb_secrets()","secret inspection"],
  ["SELECT * FROM 'https://evil.example/a.csv'","direct URL relation"],
  ["SELECT * FROM 'local_1.csv'","direct file relation"],
  ["SELECT * FROM query('DROP VIEW safe_table')","nested SQL query()"],
  ["WITH x AS (SELECT 1) SELECT * FROM query('INSTALL httpfs')","nested INSTALL"],
  ["SELECT write_log('x')","side effect"],
  ["SELECT checkpoint()","checkpoint side effect"],
  ["WITH x AS (SELECT 1) DELETE FROM x","DML"],
  ["WITH x AS (SELECT 1) SELECT * FROM x; COPY x TO 'x.csv'","multi statement"]
];
for(const [sql,label] of blocked)assert.throws(()=>cleanReadOnlySql(sql),undefined,label);

assert.equal(safeRemoteHttpUrl("https://data.example.be/file.csv"),"https://data.example.be/file.csv");
assert.equal(safeRemoteHttpUrl("http://data.example.be/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://user:pass@data.example.be/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://localhost/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://127.0.0.1/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://192.168.1.5/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://172.20.0.1/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://100.64.0.1/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://169.254.169.254/file.csv"),null);
assert.equal(safeRemoteHttpUrl("https://198.18.0.1/file.csv"),null);

assert.equal(safeCsvCellValue("=WEBSERVICE(\"https://evil.example\")"),"'=WEBSERVICE(\"https://evil.example\")");
assert.equal(safeCsvCellValue("+cmd"),"'+cmd");
assert.equal(safeCsvCellValue("@SUM(A1:A2)"),"'@SUM(A1:A2)");
assert.equal(safeCsvCellValue("-1+2"),"'-1+2");
assert.equal(safeCsvCellValue(-42),"-42");
assert.equal(safeCsvCellValue("normal"),"normal");

console.log(JSON.stringify({ok:true,allowed:ok.length,blocked:blocked.length,urlGuard:true,csvFormulaGuard:true}));
