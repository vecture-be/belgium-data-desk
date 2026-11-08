import assert from "node:assert/strict";
import { SOURCES } from "../public/data.mjs";
import { EXTRA_SOURCES } from "../public/deep-data.mjs";
import { createPublisherNamer, publisherReference } from "../public/dataset-publisher-v1.mjs";

const {publisherDisplayName}=createPublisherNamer([...SOURCES,...EXTRA_SOURCES,{url:"https://www.vlaanderen.be/digitaal",name:"Digitaal Vlaanderen",org:"Digitaal Vlaanderen"},{url:"https://statbel.fgov.be",name:"Statbel",org:"Statbel — Belgian statistical office"}]);

// Regression: a shared parent domain (vlaanderen.be) used to rename 12k records to "Digitaal Vlaanderen".
const dov={provider:"Databank Ondergrond Vlaanderen (DOV)",discovery:"data.gov.be",evidence:["https://www.dov.vlaanderen.be/page/h3o"],distributions:[["WMS","WMS","","","https://www.dov.vlaanderen.be/geoserver/h3o/wms"]]};
assert.equal(publisherDisplayName(dov),"Databank Ondergrond Vlaanderen (DOV)");
assert.equal(publisherDisplayName({provider:"City of Ghent",discovery:"data.gov.be",evidence:["https://data.stad.gent/explore/dataset/x/"],distributions:[]}),"City of Ghent");
assert.equal(publisherDisplayName({provider:"Departement Omgeving",discovery:"data.gov.be",evidence:["https://omgeving.vlaanderen.be/x"],distributions:[]}),"Departement Omgeving");

// the catalogue's own publisher wins even when the host is a curated one
assert.equal(publisherDisplayName({provider:"Statbel",discovery:"data.gov.be",evidence:["https://statbel.fgov.be/en/x"],distributions:[]}),"Statbel");

// unusable names fall back to an EXACT curated host, then to an honest generic label
assert.equal(publisherDisplayName({provider:"data.gov.be source",discovery:"data.gov.be",evidence:["https://statbel.fgov.be/en/x"],distributions:[]}),"Statbel — Belgian statistical office");
assert.equal(publisherDisplayName({provider:"data.gov.be source",discovery:"data.gov.be",evidence:["https://random.vlaanderen.be/x"],distributions:[]}),"data.gov.be publisher");
assert.equal(publisherDisplayName({provider:"5d41402abc4b2a76b9719d911017c592aaaa",discovery:"data.gov.be",evidence:[],distributions:[]}),"data.gov.be publisher");

// enterprise numbers: curated names first, otherwise show the number rather than guessing
assert.equal(publisherReference({provider:"0477445084"}),"0477445084");
assert.equal(publisherDisplayName({provider:"0477445084",discovery:"data.gov.be",evidence:[],distributions:[]}),"Fluvius");
assert.equal(publisherDisplayName({provider:"0123456789",discovery:"data.gov.be",evidence:[],distributions:[]}),"Belgian organisation 0123.456.789");
// a readable declared name beats an enterprise-number URI; a bare number is only shown as a number
assert.equal(publisherDisplayName({provider:"IWEPS",publisherUri:"https://org/CbeRegisteredEntity/0123456789",discovery:"data.gov.be",evidence:[],distributions:[]}),"IWEPS");
assert.equal(publisherDisplayName({provider:"0123456789",publisherUri:"https://org/CbeRegisteredEntity/0123456789",discovery:"data.gov.be",evidence:[],distributions:[]}),"Belgian organisation 0123.456.789");

console.log("publisher naming tests passed");
