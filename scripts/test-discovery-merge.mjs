import assert from "node:assert/strict";
import { identityKeys, isNationalIndexed, mergeDiscoveredAssets } from "../public/dataset-discovery-v1.mjs";

const direct={
  id:"harvest:elia:ods001",depth:"structured",provider:"Elia",product:"Elia",datasetId:"ods001",
  evidence:["https://opendata.elia.be/explore/dataset/ods001/"],distributions:[],discovery:"publisher",title:"Load"
};
const nationalElia={
  id:"national:elia",depth:"harvested",provider:"Elia",datasetId:"https://opendata.elia.be/explore/dataset/ods001/",
  evidence:["https://opendata.elia.be/explore/dataset/ods001/"],distributions:[],discovery:"data.gov.be",title:"Load",contactEmail:"open-data@example.test",contactName:"Open data team"
};
const favv={
  id:"national:favv",depth:"harvested",provider:"FAVV",datasetId:"favv-afsca-operators",
  evidence:["https://favv-afsca.be/nl/dataset/favv-afsca-operators"],distributions:[],discovery:"data.gov.be",title:"List of operators"
};

const fluviusUrlId={
  id:"national:fluvius-url",depth:"harvested",provider:"0477445084",
  datasetId:"https://opendata.fluvius.be/explore/dataset/1_01-verbruiksgegevens-op-nace-sectorniveau000/",
  evidence:["https://opendata.fluvius.be/explore/dataset/1_01-verbruiksgegevens-op-nace-sectorniveau000/"],
  distributions:[],discovery:"data.gov.be",title:"Verbruiksgegevens per NACE Sector"
};
const fluviusSlugId={
  id:"national:fluvius-slug",depth:"harvested",provider:"data.gov.be source",
  datasetId:"1_01-verbruiksgegevens-op-nace-sectorniveau000",
  evidence:["https://catalog.data.gov.be/dataset/fluvius"],
  distributions:[["Records API","JSON","","","https://opendata.fluvius.be/api/explore/v2.1/catalog/datasets/1_01-verbruiksgegevens-op-nace-sectorniveau000/records?limit=20"]],
  discovery:"data.gov.be",title:"Verbruiksgegevens per NACE Sector"
};

const uuid="34c05dbb-6def-440b-864f-a755333042b4";
const metawalRecord={id:"harvest:wallonia:"+uuid,depth:"harvested",provider:"SPW Wallonia — Metawal",datasetId:uuid,evidence:["https://metawal.wallonie.be/geonetwork/srv/fre/catalog.search#/metadata/"+uuid],distributions:[],discovery:"publisher",title:"Bruit des aéroports wallons"};
const dcatRecord={id:"national:x",depth:"harvested",provider:"SPW-SG Secrétariat général",datasetId:"https://geoportail.wallonie.be/catalogue/"+uuid,evidence:["https://geoportail.wallonie.be/catalogue/"+uuid],distributions:[],discovery:"data.gov.be",title:"Bruit des aéroports wallons"};
const otherRecord={id:"national:y",depth:"harvested",provider:"SPW-SG Secrétariat général",datasetId:"https://geoportail.wallonie.be/catalogue/11111111-2222-3333-4444-555555555555",evidence:[],distributions:[],discovery:"data.gov.be",title:"Different record"};
assert.equal(mergeDiscoveredAssets([metawalRecord,dcatRecord,otherRecord]).length,2,"same UUID from two catalogues must merge, different UUIDs must not");
// Regression: distinct datasets that share a service endpoint or a catalogue landing page must never merge away.
const WMS="https://www.dov.vlaanderen.be/geoserver/g3dv3/wms?SERVICE=WMS&version=1.3.0&request=GetMap";
const layers=Array.from({length:40},(_,i)=>({id:"national:layer"+i,depth:"harvested",provider:"Databank Ondergrond Vlaanderen (DOV)",datasetId:"layer-"+i,title:"G3Dv3 layer "+i,
  evidence:["https://www.dov.vlaanderen.be/page/g3d"],distributions:[["WMS","WMS","","",WMS]],discovery:"data.gov.be"}));
const repository=Array.from({length:25},(_,i)=>({id:"national:rdr"+i,depth:"harvested",provider:"Catholic University of Leuven",datasetId:"doi:10.48804/X"+i,title:"Replication Data for paper "+i,
  evidence:["https://data.gov.be/kulrdr"],distributions:[],discovery:"data.gov.be"}));
assert.equal(mergeDiscoveredAssets([...layers,...repository]).length,65,"shared endpoints/landing pages must not collapse distinct datasets");
const sharedFile={id:"national:file1",depth:"harvested",provider:"Statbel",datasetId:"a",title:"Population by sex",evidence:[],distributions:[["x","CSV","","","https://statbel.fgov.be/download/pop.csv"]],discovery:"data.gov.be"};
const sameFileOtherSource={id:"harvest:statbel:a",depth:"structured",provider:"Statbel",datasetId:"a",title:"Population by sex",evidence:[],distributions:[["x","CSV","","","https://statbel.fgov.be/download/pop.csv"]],discovery:"publisher"};
assert.equal(mergeDiscoveredAssets([sharedFile,sameFileOtherSource]).length,1,"a real cross-source duplicate still merges");
// the merged record remembers the id it absorbed, so a link to that id still opens it
{
  const merged=mergeDiscoveredAssets([sharedFile,sameFileOtherSource]);
  assert.deepEqual(merged[0].aliases,[merged[0].id==="harvest:statbel:a"?"national:file1":"harvest:statbel:a"],"merged id kept as alias");
}
// a data service (API, LDES stream) sharing a landing page or id with the dataset it serves stays a separate record
{
  const ds={id:"harvest:gipod:HINDER",depth:"structured",provider:"Digitaal Vlaanderen",datasetId:"gipod-hinder",title:"GIPOD hinder",evidence:["https://gipod.vlaanderen.be"],distributions:[],discovery:"publisher"};
  const svc={id:"national:gipod-ldes",depth:"harvested",provider:"Digitaal Vlaanderen",datasetId:"gipod-hinder",title:"GIPOD hinder (LDES)",dataKind:"data-service",evidence:["https://gipod.vlaanderen.be"],
    distributions:[["Service endpoint","LDES","","","https://gipod.api.vlaanderen.be/api/v1/ldes/mobility-hindrances"]],discovery:"data.gov.be"};
  const out=mergeDiscoveredAssets([ds,svc]);
  assert.equal(out.length,2,"a data service is not merged into the dataset it serves");
  assert.ok(identityKeys(svc).every(k=>k.startsWith("service:")));
}


assert.ok(identityKeys(direct).includes("elia|ods001"));
assert.ok(identityKeys(nationalElia).includes("elia|ods001"));
assert.ok(identityKeys(favv).includes("favv|favv-afsca-operators"));

assert.ok(identityKeys(fluviusUrlId).includes("fluvius|1_01-verbruiksgegevens-op-nace-sectorniveau000"));
assert.ok(identityKeys(fluviusSlugId).includes("fluvius|1_01-verbruiksgegevens-op-nace-sectorniveau000"));

const merged=mergeDiscoveredAssets([direct,nationalElia,favv,fluviusUrlId,fluviusSlugId]);
assert.equal(merged.length,3);
const elia=merged.find(x=>x.datasetId==="ods001");
assert.ok(elia);
assert.equal(elia.id,direct.id);
assert.equal(elia.depth,"structured");
assert.equal(isNationalIndexed(elia),true);
assert.deepEqual(new Set(elia.discoverySources),new Set(["publisher","data.gov.be"]));
assert.equal(elia.contactEmail,"open-data@example.test");
assert.equal(elia.contactName,"Open data team");

const favvOut=merged.find(x=>x.datasetId==="favv-afsca-operators");
assert.ok(favvOut);
assert.equal(favvOut.discovery,"data.gov.be");
assert.equal(isNationalIndexed(favvOut),true);

const fluviusOut=merged.find(x=>String(x.datasetId).includes("1_01-verbruiksgegevens-op-nace-sectorniveau000"));
assert.ok(fluviusOut);
assert.equal(merged.filter(x=>String(x.title).includes("Verbruiksgegevens per NACE Sector")).length,1);

console.log(JSON.stringify({ok:true,unique:merged.length,elia:elia.id,favv:favvOut.id,fluvius:fluviusOut.id}));
