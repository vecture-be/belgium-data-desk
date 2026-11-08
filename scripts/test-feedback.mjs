import assert from "node:assert/strict";
import { contactFor, profileLines, reportText } from "../public/dataset-feedback-v1.mjs";

const asset={
  id:"dataset:test",datasetId:"publisher-dataset-42",title:"Municipality observations",
  provider:"Example Publisher",contactName:"Open Data Team",contactEmail:"data@example.be",
  contactUrl:"https://example.be/open-data/contact",officialUrl:"https://example.be/open-data/42",
  updatedAt:"2026-09-30",
  distributions:[["CSV","CSV","","","https://example.be/open-data/42.csv"]]
};
const profile={
  url:"https://example.be/open-data/42.csv",rowCount:100,rowCountKind:"exact",bytesRead:4096,
  fields:[
    {name:"municipality_id",missing:0,duplicates:4,min:"1000",max:"9999"},
    {name:"value",missing:3,duplicates:10,min:"0",max:"900"}
  ],
  businessKey:{fields:["municipality_id"],rows:100,uniqueKeys:98,nullRows:0,duplicateRows:4,duplicateGroups:2,exact:true}
};

assert.deepEqual(contactFor(asset),{
  email:"data@example.be",url:"https://example.be/open-data/contact",name:"Open Data Team"
});
assert.equal(contactFor({...asset,contactEmail:"not-an-email"}).email,"");
assert.match(profileLines(profile).join("\n"),/Duplicate key groups: 2/);
assert.match(profileLines(profile).join("\n"),/value: 3 missing; 10 duplicate values/);

const body=reportText({
  asset,publisherName:"Example Publisher",profile,issue:"duplicates",
  details:"municipality_id is expected to identify one row.",
  distribution:"https://example.be/open-data/42.csv",includeDiagnostics:true
});
assert.match(body,/Issue: Duplicate rows \/ non-unique key/);
assert.match(body,/Dataset ID: publisher-dataset-42/);
assert.match(body,/Tested key: municipality_id/);
assert.match(body,/Duplicate key groups: 2/);
assert.match(body,/Belgium Data Desk does not send email on the user's behalf/);

const noDiagnostics=reportText({asset,issue:"stale",details:"Latest period looks old.",distribution:"",includeDiagnostics:false});
assert.doesNotMatch(noDiagnostics,/Browser observations:/);

console.log(JSON.stringify({ok:true,contact:contactFor(asset).email,reportLines:body.split("\n").length}));
