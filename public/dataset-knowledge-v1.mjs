import { DATASET_RELATIONSHIPS as LEGACY_RELATIONSHIPS } from "./dataset-atlas-v1.mjs";

export const IDENTIFIER_REGISTRY=[
  {id:"enterprise-number",label:"Belgian enterprise number",namespace:"CBE / KBO",owner:"FPS Economy",scope:"Belgian legal entities",family:"entity",stability:"persistent entity identifier",versioned:false,example:"0xxx.xxx.xxx",caveat:"Use the canonical enterprise number; company names and addresses are not substitutes."},
  {id:"establishment-unit-number",label:"Establishment-unit number",namespace:"CBE / KBO",owner:"FPS Economy",scope:"Belgian establishment units",family:"entity",stability:"persistent establishment identifier",versioned:false,example:"2.xxx.xxx.xxx",caveat:"An enterprise can have multiple establishment units."},
  {id:"nace-bel",label:"NACE-BEL activity code",namespace:"NACE-BEL",owner:"Statbel / FPS Economy ecosystem",scope:"Economic activity classification",family:"classification",stability:"versioned classification",versioned:true,example:"activity code",caveat:"A matching code is only meaningful when the classification version and analytical period are compatible."},
  {id:"nis-municipality",label:"NIS municipality code",namespace:"REFNIS / Statbel",owner:"Statbel",scope:"Belgian administrative geography",family:"geography",stability:"stable within a geography vintage",versioned:true,example:"5-digit municipality code",caveat:"Municipal mergers and boundary/code-table vintages matter."},
  {id:"statistical-sector",label:"Statistical-sector code",namespace:"Statbel statistical sectors",owner:"Statbel",scope:"Belgian sub-municipal statistical geography",family:"geography",stability:"versioned geography code",versioned:true,example:"sector code",caveat:"From 2019 onward the municipality code must not be mechanically derived from the statistical-sector code; use the relevant code table."},
  {id:"basis-address-id",label:"Basisregister address object ID",namespace:"Basisregisters Vlaanderen",owner:"Digitaal Vlaanderen",scope:"Flemish canonical addresses",family:"entity",stability:"persistent registry identifier",versioned:false,example:"objectId / persistent URI",caveat:"Registry identity is stronger than address-text matching."},
  {id:"capakey",label:"CaPaKey",namespace:"Belgian cadastral parcel reference",owner:"FPS Finance / cadastral ecosystem",scope:"Cadastral parcels",family:"entity",stability:"parcel-reference identifier",versioned:true,example:"11001B0001/00S000",caveat:"Parcel mutations and cadastral vintage matter; agricultural declaration parcels are a different concept."},
  {id:"grb-feature-id",label:"GRB feature ID",namespace:"GRB collection",owner:"Digitaal Vlaanderen",scope:"Collection-specific GRB features",family:"entity",stability:"collection/model scoped",versioned:false,example:"featureId",caveat:"Do not equate a GRB feature ID with a Basisregisters or legal cadastral identifier without an explicit mapping."},
  {id:"gtfs-feed-id",label:"GTFS feed-scoped IDs",namespace:"GTFS publisher/feed",owner:"Transport operator",scope:"stop_id / trip_id / route_id within one provider feed",family:"entity",stability:"feed scoped",versioned:true,example:"stop_id / trip_id / route_id",caveat:"These are not Belgian national identifiers."},
  {id:"nbb-deposit-reference",label:"NBB deposit reference",namespace:"NBB CBSO",owner:"National Bank of Belgium",scope:"Published annual-account filing references",family:"document",stability:"filing reference",versioned:false,example:"deposit reference",caveat:"Document representations available for a reference depend on filing age and publication/product rules."},
  {id:"infrabel-ptcar",label:"Infrabel PTCAR number",namespace:"Infrabel punctuality datasets",owner:"Infrabel",scope:"Train/run observation linkage inside documented datasets",family:"entity",stability:"dataset-specific operational identifier",versioned:true,example:"PTCAR_NO",caveat:"Do not promote an Infrabel operational identifier to a cross-operator national identifier."},
  {id:"education-institution-id",label:"Education institution identifier",namespace:"Onderwijs & Vorming",owner:"Flemish Department of Education and Training",scope:"Recognised education institutions",family:"entity",stability:"registry identifier",versioned:false,example:"institution identifier",caveat:"Institution, vestiging and lesplaats are different grains."},
  {id:"education-location-id",label:"Education location composite",namespace:"Onderwijs & Vorming",owner:"Flemish Department of Education and Training",scope:"Vestigingen / lesplaatsen",family:"entity",stability:"hierarchical identifier",versioned:false,example:"institution + vestigingsnummer (+ lesplaatscode)",caveat:"Vestigingsnummer is only unique within its institution."},
  {id:"waterinfo-station-id",label:"Waterinfo station / time-series ID",namespace:"VMM / MOW Waterinfo",owner:"VMM / MOW",scope:"Hydrological monitoring stations and series",family:"observation",stability:"station/series scoped",versioned:true,example:"station_id + ts_id",caveat:"Station identity and time-series identity are different; keep parameter and unit with observations."},
  {id:"election-level-id",label:"Election / election-level ID",namespace:"FPS Interior Elections",owner:"FPS Interior",scope:"Election result hierarchy",family:"entity",stability:"election scoped",versioned:false,example:"election id + election-level id",caveat:"Electoral geography and publication depth change historically."}
];

export const CROSSWALK_REGISTRY=[
  {id:"sector-to-municipality",from:"statistical-sector",to:"nis-municipality",operation:"versioned_lookup",cardinality:"n:1",direction:"forward",evidenceLevel:"publisher-explicit",requires:["matching statistical-sector code table / boundary vintage"],lossiness:"none",caveat:"Use the relevant Statbel code table; do not derive municipality mechanically from the sector code after the post-2019 coding changes."},
  {id:"address-to-municipality",from:"basis-address-id",to:"nis-municipality",operation:"registry_traversal",cardinality:"n:1",direction:"forward",evidenceLevel:"publisher-explicit",requires:["canonical Basisregisters address object"],lossiness:"none",caveat:"Applies to the Flemish register scope."},
  {id:"address-to-parcel",from:"basis-address-id",to:"capakey",operation:"registry_relationship",cardinality:"n:m",direction:"bidirectional",evidenceLevel:"publisher-explicit",requires:["documented Basisregisters parcel/address relation"],lossiness:"none",caveat:"An address and a cadastral parcel are different entity types and may not be one-to-one."},
  {id:"deposit-to-enterprise",from:"nbb-deposit-reference",to:"enterprise-number",operation:"filing_reference_lookup",cardinality:"n:1",direction:"forward",evidenceLevel:"publisher-explicit",requires:["NBB reference record exposing legal entity"],lossiness:"none",caveat:"Only publication-eligible filings are visible through the relevant NBB products."},
  {id:"education-location-to-institution",from:"education-location-id",to:"education-institution-id",operation:"hierarchical_lookup",cardinality:"n:1",direction:"forward",evidenceLevel:"publisher-explicit",requires:["institution reference retained with location identifier"],lossiness:"none",caveat:"Vestigingsnummer alone is insufficient because its namespace is the parent institution."}
];

export const DATASET_RELATION_TYPE_DEFS={
  exact_dimension:{label:"Exact dimension join",family:"identity",joinability:"record"},
  feed_contract:{label:"Feed contract",family:"identity",joinability:"record"},
  document_reference:{label:"Document reference",family:"identity",joinability:"record"},
  registry_relation:{label:"Registry relation",family:"identity",joinability:"record"},
  hierarchy:{label:"Hierarchy",family:"identity",joinability:"record"},
  aggregation:{label:"Aggregation",family:"aggregate",joinability:"aggregate"},
  derivation:{label:"Derived metric",family:"provenance",joinability:"aggregate"},
  temporal_alignment:{label:"Temporal alignment",family:"temporal",joinability:"analytical"},
  geography_alignment:{label:"Geography alignment",family:"spatial",joinability:"aggregate"},
  spatial_semantic:{label:"Spatial / semantic relation",family:"spatial",joinability:"analytical"},
  conceptual_comparison:{label:"Conceptual comparison",family:"semantic",joinability:"analytical"}
};

const pair=(a,b)=>[a,b].sort().join("|");
const LEGACY={
  [pair("statbel-pop-sector-2025-new","statbel-sector-geom-2025")]:{kind:"exact_dimension",operation:"join",cardinality:"1:1",namespace:"Statbel statistical-sector code + 2025 geography",grainFrom:"population record per statistical sector",grainTo:"polygon per statistical sector",temporal:"population reference year and boundary vintage are both 2025",lossiness:"none",scope:"new 2025 REDEGEO breakdown only",requires:["same 2025 statistical-sector breakdown"],failureModes:["using old-breakdown population with new-breakdown geometry"]},
  [pair("delijn-gtfs-static","delijn-gtfs-rt")]:{kind:"feed_contract",operation:"feed_key_join",cardinality:"1:n",namespace:"De Lijn GTFS feed",grainFrom:"static GTFS entity",grainTo:"realtime entity/update",temporal:"realtime entities must refer to the compatible static feed version",lossiness:"none",scope:"De Lijn provider feed",requires:["provider/feed compatibility"],failureModes:["assuming IDs are national","stale static feed"]},
  [pair("sncb-gtfs-static","sncb-gtfs-rt")]:{kind:"feed_contract",operation:"feed_key_join",cardinality:"1:n",namespace:"SNCB GTFS feed",grainFrom:"static GTFS entity",grainTo:"realtime entity/update",temporal:"realtime entities must refer to compatible static feed version",lossiness:"none",scope:"SNCB provider feed",requires:["provider/feed compatibility"],failureModes:["mapping GTFS IDs directly to Infrabel infrastructure IDs"]},
  [pair("infrabel-punct-raw","infrabel-punct-stop")]:{kind:"aggregation",operation:"group_or_validate",cardinality:"n:1",namespace:"Infrabel PTCAR / stop context",grainFrom:"event-level punctuality observation",grainTo:"stop-level punctuality aggregate",temporal:"period and service context must match",lossiness:"high",scope:"same-publisher punctuality datasets",requires:["PTCAR/stop fields as documented","compatible period"],failureModes:["aggregate treated as event record"]},
  [pair("nbb-auth-refs","nbb-auth-doc")]:{kind:"document_reference",operation:"lookup",cardinality:"1:1",namespace:"NBB deposit reference",grainFrom:"filing reference",grainTo:"document representation",temporal:"representation availability depends on filing age/product",lossiness:"none",scope:"NBB Authentic Data Query/document services",requires:["publication-eligible deposit reference"],failureModes:["requested representation unavailable for older filing"]},
  [pair("nbb-daily-refs","nbb-daily-accounting")]:{kind:"document_reference",operation:"batch_join",cardinality:"1:1",namespace:"publication date + deposit reference",grainFrom:"daily publication reference",grainTo:"daily accounting data item",temporal:"same publication batch/date",lossiness:"none",scope:"same daily publication set",requires:["matching publication batch and deposit reference"],failureModes:["mixing batches"]},
  [pair("basis-address-v2","basis-parcel-v2")]:{kind:"registry_relation",operation:"registry_traversal",cardinality:"n:m",namespace:"Basisregisters address/parcel relationship",grainFrom:"canonical address object",grainTo:"parcel object / parcel-address relation",temporal:"current register state",lossiness:"none",scope:"Flemish Basisregisters",requires:["documented adresId/parcel relationship"],failureModes:["address text used instead of registry identity"]},
  [pair("basis-parcel-v2","grb-adp")]:{kind:"spatial_semantic",operation:"spatial_or_semantic_compare",cardinality:"n:m",namespace:"no universal shared ID",grainFrom:"parcel registry object",grainTo:"GRB ADP map/reference feature",temporal:"register/reference-map state can differ",lossiness:"possible",scope:"Flanders",requires:["explicit mapping if available; otherwise spatial validation"],failureModes:["GRB feature ID equated to parcel registry identity","overlap treated as legal identity"]},
  [pair("elia-ods001","elia-ods201")]:{kind:"temporal_alignment",operation:"time_align",cardinality:"n:m",namespace:"datetime + verified compatible resolution",grainFrom:"load observation/forecast",grainTo:"generation-by-fuel observation",temporal:"timezone/resolution and publication semantics must align",lossiness:"possible",scope:"Elia time-series analysis",requires:["compatible resolution","explicit time alignment"],failureModes:["different time resolutions joined naively"]},
  [pair("ircel-pm10-station","ircel-rio-commune")]:{kind:"aggregation",operation:"spatial_temporal_aggregate",cardinality:"n:m",namespace:"time + harmonised geography",grainFrom:"station observation",grainTo:"modelled municipality output",temporal:"align temporal aggregation",lossiness:"high",scope:"air-quality comparison",requires:["spatial aggregation/model interpretation"],failureModes:["station observation treated as municipality exposure"]},
  [pair("agri-flanders-2026-s1","agri-wallonia-all-years")]:{kind:"conceptual_comparison",operation:"harmonise_then_compare",cardinality:"n:m",namespace:"campaign year + harmonised crop/parcel concepts",grainFrom:"Flemish declaration parcel",grainTo:"Walloon declaration parcel",temporal:"campaign publication calendars differ",lossiness:"high",scope:"cross-region agriculture analysis",requires:["concept/crop harmonisation","campaign alignment"],failureModes:["assuming shared parcel ID","provisional/final status ignored"]}
};

const EXTRA=[
  {from:"onderwijs-instellingen-v2",to:"onderwijs-locations-v1",kind:"hierarchy",key:"institution identifier",operation:"parent_child_join",cardinality:"1:n",namespace:"Onderwijs & Vorming institution ID",grainFrom:"institution",grainTo:"institution location",temporal:"current API states",lossiness:"none",scope:"Flemish education registry",evidenceLevel:"publisher-schema",requires:["retain parent institution identifier"],failureModes:["vestigingsnummer treated as globally unique"]},
  {from:"onderwijs-instellingen-v2",to:"onderwijs-bao-offering-v2",kind:"hierarchy",key:"institution identifier",operation:"parent_child_join",cardinality:"1:n",namespace:"Onderwijs & Vorming institution ID",grainFrom:"institution",grainTo:"education offering",temporal:"current API states",lossiness:"none",scope:"primary-education offering API",evidenceLevel:"publisher-schema",requires:["distinguish recognised from actually organised offering"],failureModes:["theoretical recognition treated as current enrolment"]},
  {from:"onderwijs-locations-v1",to:"onderwijs-bao-offering-v2",kind:"hierarchy",key:"institution + vestigingsplaats where exposed",operation:"scoped_child_join",cardinality:"1:n",namespace:"Onderwijs & Vorming location hierarchy",grainFrom:"institution location",grainTo:"offering at institution/location scope",temporal:"current API states",lossiness:"possible",scope:"only offerings exposed at compatible location scope",evidenceLevel:"publisher-schema",requires:["institution context","compatible vestigingsplaats scope"],failureModes:["institution-level offering forced onto one location"]},
  {from:"waterinfo-monitoring-points",to:"waterinfo-discharge-timeseries",kind:"hierarchy",key:"station identity; time-series ID for observations",operation:"station_series_join",cardinality:"1:n",namespace:"Waterinfo station / series",grainFrom:"monitoring station feature",grainTo:"station time-series observation",temporal:"station reference state + series observation period",lossiness:"none",scope:"compatible VMM/MOW hydrometric stations",evidenceLevel:"curated-schema-alignment",requires:["station identifier compatibility","retain ts_id, parameter and unit"],failureModes:["station name used as key","station feature treated as an observation"]},
  {from:"ibz-election-list-results",to:"ibz-election-candidate-results",kind:"hierarchy",key:"election + election-level + list",operation:"parent_child_join",cardinality:"1:n",namespace:"FPS Interior election hierarchy",grainFrom:"list result",grainTo:"candidate result",temporal:"same election",lossiness:"none",scope:"candidate results available for the election period",evidenceLevel:"publisher-schema",requires:["same election and election-level","stable list identity within election"],failureModes:["candidate name treated as cross-election person ID"]},
  {from:"opgroeien-childcare-capacity-2026",to:"opgroeien-childcare-coverage-2026",kind:"derivation",key:"geography + publication period",operation:"derive_ratio",cardinality:"1:1",namespace:"Opgroeien publication geography",grainFrom:"childcare capacity aggregate",grainTo:"places-per-100-children indicator",temporal:"same 2026 publication context",lossiness:"high",scope:"published coverage indicator",evidenceLevel:"publisher-methodology",requires:["same geography","retain denominator methodology"],failureModes:["capacity ratio interpreted as utilisation or unmet demand"]},
  {from:"fluvius-consumption-sector-nace",to:"statbel-sector-geom-2025",kind:"geography_alignment",key:"statistical-sector code after vintage validation",operation:"versioned_geography_join",cardinality:"n:1",namespace:"Statbel statistical-sector geography",grainFrom:"year × energy × direction × sector × NACE aggregate",grainTo:"statistical-sector polygon",temporal:"Fluvius calendar year must be reconciled with the 2025 sector boundary vintage",lossiness:"possible",scope:"records whose statistical-sector coding is compatible with the selected boundary version",evidenceLevel:"cross-source-qualified",requires:["verify statistical-sector vintage","do not derive municipality from code text"],failureModes:["cross-vintage sector code collision"]},
  {from:"elections-2024-municipality-results",to:"statbel-refnis-2025",kind:"geography_alignment",key:"municipality after vintage crosswalk",operation:"versioned_admin_align",cardinality:"n:1",namespace:"Belgian municipality geography",grainFrom:"municipality election result",grainTo:"2025 administrative reference row",temporal:"2024 election geography vs 2025 REFNIS requires merger/vintage check",lossiness:"possible",scope:"municipal election-result context",evidenceLevel:"cross-source-qualified",requires:["municipality crosswalk across vintages"],failureModes:["name-only join","post-election municipal merger ignored"]},
  {from:"onem-unemployment-municipality",to:"statbel-refnis-2025",kind:"geography_alignment",key:"municipality/administrative geography + period",operation:"versioned_admin_align",cardinality:"n:1",namespace:"Belgian administrative geography",grainFrom:"unemployment/benefit aggregate",grainTo:"administrative reference row",temporal:"monthly/statistical period and municipality vintage must align",lossiness:"possible",scope:"municipality-level ONEM statistics",evidenceLevel:"cross-source-qualified",requires:["compatible municipality vintage"],failureModes:["benefit population interpreted as all jobseekers"]},
  {from:"bipt-mobile-coverage-2016",to:"statbel-refnis-2025",kind:"geography_alignment",key:"municipality via historical crosswalk",operation:"historical_admin_crosswalk",cardinality:"1:1",namespace:"Belgian municipality geography",grainFrom:"2016 municipality coverage aggregate",grainTo:"2025 administrative reference row",temporal:"2016 to 2025 municipality geography",lossiness:"possible",scope:"historical telecom coverage analysis",evidenceLevel:"cross-source-qualified",requires:["historical municipality crosswalk"],failureModes:["2016 coverage treated as current","municipal reforms ignored"]},
  {from:"riziv-nomensoft-full",to:"riziv-nomensoft-delta",kind:"document_reference",key:"nomenclature/reference key + release/application sequence",operation:"apply_delta_in_release_order",cardinality:"n:m",namespace:"RIZIV NomenSoft reference data",grainFrom:"coordinated reference-table record",grainTo:"change record between coordinated releases",temporal:"delta validity/update window must follow the correct coordinated release",lossiness:"none",scope:"NomenSoft technical reference maintenance",evidenceLevel:"publisher-methodology",requires:["start from the matching coordinated release","apply deltas in publisher order"],failureModes:["delta applied to wrong base release","application date ignored"]},
  {from:"infrabel-punct-raw",to:"infrabel-punct-monthly",kind:"aggregation",key:"period + publisher punctuality definitions",operation:"aggregate_then_reconcile",cardinality:"n:1",namespace:"Infrabel punctuality methodology",grainFrom:"train × stopping-point event",grainTo:"national monthly punctuality aggregate",temporal:"events must fall in the target month and use compatible neutralisation rules",lossiness:"high",scope:"same-publisher punctuality analysis",evidenceLevel:"curated-schema-alignment",requires:["match month","reproduce published punctuality/neutralisation definitions"],failureModes:["simple event average assumed to equal official monthly metric","neutralised and non-neutralised measures mixed"]}
];

const defaults=r=>({
  id:pair(r.from,r.to)+":"+(r.kind||"relationship"),
  from:r.from,to:r.to,kind:r.kind||"conceptual_comparison",key:r.key||"dataset-specific",
  operation:r.operation||"manual_validation",cardinality:r.cardinality||"n:m",namespace:r.namespace||"dataset-specific",
  grainFrom:r.grainFrom||"source dataset grain",grainTo:r.grainTo||"target dataset grain",temporal:r.temporal||"verify compatible period/version",
  lossiness:r.lossiness||"possible",scope:r.scope||"dataset-specific relationship",evidenceLevel:r.evidenceLevel||"curated",
  requires:r.requires||["verify exact dataset fields and versions"],failureModes:r.failureModes||["relationship over-generalised beyond documented scope"],
  note:r.note||"",legacyType:r.type||null
});
const enrichedLegacy=LEGACY_RELATIONSHIPS.map(r=>({...defaults(r),...(LEGACY[pair(r.from,r.to)]||{})}));
export const DATASET_RELATIONSHIPS_V2=[...enrichedLegacy,...EXTRA.map(defaults)];

export const DIMENSION_DEFS=[
  {id:"enterprise",label:"enterprise",family:"entity",re:/\benterprise\b|legal entity|ondernemingsnummer/i},
  {id:"filing",label:"filing / deposit",family:"entity",re:/deposit reference|filing|annual account/i},
  {id:"institution",label:"institution",family:"entity",re:/institution identifier|institution reference|\binstitution\b/i},
  {id:"candidate",label:"candidate",family:"entity",re:/candidate result|\bcandidate\b/i},
  {id:"political-list",label:"political list",family:"entity",re:/list \/ political party|\blist result\b|list\/candidate/i},
  {id:"route",label:"route",family:"entity",re:/route_id|\broutes\b/i},
  {id:"trip",label:"trip",family:"entity",re:/trip_id|\btrips\b/i},
  {id:"stop",label:"stop",family:"entity",re:/stop_id|stop_times|\bstop-level\b/i},
  {id:"station",label:"station",family:"entity",re:/station_id|station_no|monitoring point|\bstation\b/i},
  {id:"device",label:"sensor / device",family:"entity",re:/device|detector|counter/i},
  {id:"parcel",label:"parcel",family:"space",re:/\bparcel\b|cadastral-plan/i},
  {id:"address",label:"address",family:"space",re:/\baddress\b|adresid/i},
  {id:"street",label:"street",family:"space",re:/\bstreet\b/i},
  {id:"postcode",label:"postcode",family:"space",re:/postcode/i},
  {id:"statistical-sector",label:"statistical sector",family:"space",re:/statistical[- ]sector/i},
  {id:"municipality",label:"municipality",family:"space",re:/municipality|municipal|hoofdgemeente|commune/i},
  {id:"province",label:"province",family:"space",re:/\bprovince\b/i},
  {id:"region",label:"region",family:"space",re:/\bregion\b/i},
  {id:"grid-cell",label:"grid / raster cell",family:"space",re:/grid cell|raster cell|\bcell\b.*raster/i},
  {id:"road-segment",label:"road segment",family:"space",re:/road segment|road-segment/i},
  {id:"geometry",label:"geometry",family:"space-generic",re:/geometry|polygon|point feature|line feature|vector feature/i},
  {id:"nace",label:"NACE",family:"classification",re:/nace/i},
  {id:"pollutant",label:"pollutant",family:"classification",re:/pollutant|pm10|no2|ozone/i},
  {id:"fuel-type",label:"fuel type",family:"classification",re:/fuel type/i},
  {id:"technology",label:"technology",family:"classification",re:/technology|technologie/i},
  {id:"care-type",label:"care type",family:"classification",re:/care type|childcare type|provision type/i},
  {id:"tariff",label:"tariff",family:"classification",re:/tariff|income tariff/i},
  {id:"election",label:"election",family:"event",re:/election id|election date|\belection\b/i},
  {id:"election-level",label:"election level",family:"space",re:/election-level|election level/i},
  {id:"residence",label:"residence",family:"space",re:/\bresidence\b/i},
  {id:"nationality",label:"nationality",family:"classification",re:/nationality/i},
  {id:"marital-status",label:"marital status",family:"classification",re:/marital status/i},
  {id:"age",label:"age",family:"classification",re:/\bage\b/i},
  {id:"sex",label:"sex",family:"classification",re:/\bsex\b/i},
  {id:"train",label:"train / run",family:"entity",re:/train_no|train ×|train observation/i},
  {id:"stopping-point",label:"stopping point",family:"entity",re:/stopping point|ptcar_no/i},
  {id:"nomenclature-code",label:"nomenclature / reference key",family:"reference",joinable:false,re:/nomenclature \/ reference keys|\breference key\b/i},
  {id:"imagery-feature",label:"imagery metadata feature",family:"reference",joinable:false,re:/aerial-photo metadata|photo centroid|photo footprint|flight path/i},
  {id:"accident-event",label:"road accident",family:"event",joinable:false,re:/road accident|\baccident\b/i},
  {id:"admin-code-entry",label:"administrative code entry",family:"reference",joinable:false,re:/administrative\/geographic code entry|refnis\/nis code/i},
  {id:"planning-entity",label:"planning linked-data entity",family:"reference",joinable:false,re:/planning case|linked rdf entities|algplanid|\bzaak\b/i},
  {id:"scenario",label:"scenario horizon",family:"reference",joinable:false,re:/scenario horizon|climate-scenario/i},
  {id:"reference-point",label:"reference point",family:"space",re:/reference point/i},
  {id:"registry-change",label:"registry change",family:"reference",joinable:false,re:/changes since previous|change content/i},
  {id:"realtime-entity",label:"realtime feed entity",family:"reference",joinable:false,re:/realtime .* entit|gtfs realtime entities/i},
  {id:"parameter",label:"parameter",family:"classification",re:/parameter type|parametertype/i}
];

const TIME_RULES=[
  ["15-minute",/15[- ]minute/i],["instant",/timestamp|datetime|realtime|real[- ]time/i],["day",/\bdaily\b|\bday\b/i],
  ["month",/\bmonthly\b|\bmonth\b/i],["year",/calendar year|financial year|reference year|\bannual\b|\byear\b/i],
  ["snapshot",/snapshot|current .*state|situation measure|application-date|validity window/i],["event-date",/election date/i],["campaign",/campaign year|campaign/i],["scenario",/scenario horizon|2050|2100/i]
];
const SPATIAL_ORDER=["address","parcel","street","postcode","grid-cell","statistical-sector","municipality","province","region"];

const textFor=a=>[a.grain,a.time,a.space,a.kind,a.shape,...(a.schema||[]).map(x=>x[0])].filter(Boolean).join(" ");
export function grainSignature(asset){
  const txt=textFor(asset),dims=DIMENSION_DEFS.filter(d=>d.re.test(txt)).map(d=>d.id);
  const families=Object.fromEntries(["entity","space","space-generic","classification","event","reference"].map(f=>[f,dims.filter(id=>DIMENSION_DEFS.find(d=>d.id===id)?.family===f)]));
  const temporal=TIME_RULES.find(([,re])=>re.test(txt))?.[0]||"unspecified";
  const spatial=families.space.slice().sort((a,b)=>SPATIAL_ORDER.indexOf(a)-SPATIAL_ORDER.indexOf(b));
  const years=[...new Set(([asset.time,asset.grain].filter(Boolean).join(" ").match(/\b(?:19|20)\d{2}\b/g)||[]))].sort();
  return{dimensions:dims,entities:families.entity,spatial,classifications:families.classification,events:families.event,hasGeometry:families["space-generic"].includes("geometry"),temporal,years,origin:"inferred from curated grain/schema",rawGrain:asset.grain||""};
}

const BINDING_RULES=[
  {identifier:"enterprise-number",strength:"exact",test:a=>/enterprise number|legalentity/i.test(textFor(a))},
  {identifier:"establishment-unit-number",strength:"exact",test:a=>/establishment-unit number/i.test(textFor(a))},
  {identifier:"nace-bel",strength:"exact",test:a=>/nace/i.test(textFor(a))},
  {identifier:"nis-municipality",strength:"exact",test:a=>/\bnis code\b|refnis/i.test(textFor(a))},
  {identifier:"statistical-sector",strength:"exact",test:a=>/statistical[- ]sector code/i.test(textFor(a))||["statbel-sector-geom-2025","statbel-sector-geom-2026","fluvius-consumption-sector-nace"].includes(a.id)},
  {identifier:"basis-address-id",strength:"exact",test:a=>a.id==="basis-address-v2"&&/objectid|persistent uri/i.test(textFor(a))},
  {identifier:"capakey",strength:"qualified",test:a=>/capakey/i.test(textFor(a))||a.id==="basis-parcel-v2"},
  {identifier:"grb-feature-id",strength:"exact",test:a=>a.sourceId==="grb"&&/featureid/i.test(textFor(a))},
  {identifier:"gtfs-feed-id",strength:"qualified",test:a=>a.sourceId==="transportdata"&&/gtfs/i.test([a.kind,a.shape,a.title].join(" "))},
  {identifier:"nbb-deposit-reference",strength:"exact",test:a=>/deposit reference/i.test(textFor(a))},
  {identifier:"infrabel-ptcar",strength:"exact",test:a=>/ptcar/i.test(textFor(a))},
  {identifier:"education-institution-id",strength:"exact",test:a=>a.sourceId==="onderwijs"&&/institution identifier|institution reference/i.test(textFor(a))},
  {identifier:"education-location-id",strength:"qualified",test:a=>a.sourceId==="onderwijs"&&/vestigingsnummer|lesplaatscode/i.test(textFor(a))},
  {identifier:"waterinfo-station-id",strength:"exact",test:a=>a.sourceId==="waterinfo"&&/station_id|station_no|ts_id/i.test(textFor(a))},
  {identifier:"election-level-id",strength:"exact",test:a=>a.sourceId==="elections"&&/election-level id|election id/i.test(textFor(a))}
];
export function identifierBindings(asset){
  return BINDING_RULES.filter(r=>r.test(asset)).map(r=>({identifier:r.identifier,strength:r.strength,origin:"inferred from curated schema/grain"}));
}

function crosswalkPath(aIds,bIds){
  const target=new Set(bIds),q=aIds.map(id=>({id,path:[]})),seen=new Set(aIds);
  while(q.length){
    const cur=q.shift();if(target.has(cur.id))return cur.path;
    for(const x of CROSSWALK_REGISTRY){
      const next=[];
      if(x.from===cur.id)next.push(x.to);
      if(x.direction==="bidirectional"&&x.to===cur.id)next.push(x.from);
      for(const n of next){if(seen.has(n))continue;seen.add(n);q.push({id:n,path:[...cur.path,x]})}
    }
  }
  return[];
}
export function explicitDatasetRelation(a,b){return DATASET_RELATIONSHIPS_V2.find(r=>(r.from===a&&r.to===b)||(r.from===b&&r.to===a))||null}
export function datasetRelationsFor(id){return DATASET_RELATIONSHIPS_V2.filter(r=>r.from===id||r.to===id)}

const timeRank={"instant":1,"15-minute":2,"day":3,"month":4,"year":5,"campaign":5,"event-date":5,"snapshot":6,"unspecified":99};
export function planDatasetIntegration(left,right){
  if(!left||!right)return{status:"none",label:"Choose two curated datasets",confidence:"none",steps:[],warnings:[]};
  const explicit=explicitDatasetRelation(left.id,right.id);
  if(explicit)return{status:"explicit",label:DATASET_RELATION_TYPE_DEFS[explicit.kind]?.label||explicit.kind,confidence:explicit.evidenceLevel,operation:explicit.operation,cardinality:explicit.cardinality,key:explicit.key,namespace:explicit.namespace,steps:[...explicit.requires,explicit.operation],warnings:explicit.failureModes,lossiness:explicit.lossiness,temporal:explicit.temporal,relation:explicit};
  const a=grainSignature(left),b=grainSignature(right),ab=identifierBindings(left),bb=identifierBindings(right);
  const disjointYears=a.years.length&&b.years.length&&!a.years.some(y=>b.years.includes(y));
  const aIds=ab.map(x=>x.identifier),bIds=bb.map(x=>x.identifier),sharedIds=aIds.filter(x=>bIds.includes(x));
  const common=a.dimensions.filter(x=>b.dimensions.includes(x)&&x!=="geometry"&&DIMENSION_DEFS.find(d=>d.id===x)?.joinable!==false);
  const leftOnly=a.dimensions.filter(x=>!common.includes(x)&&x!=="geometry"),rightOnly=b.dimensions.filter(x=>!common.includes(x)&&x!=="geometry");
  const warnings=["This plan is inferred from curated grain/schema metadata, not a publisher-declared join contract."];
  if(disjointYears)warnings.push("Published year/vintage sets do not overlap ("+a.years.join(", ")+" vs "+b.years.join(", ")+"); use a historical/version crosswalk before treating keys as comparable.");
  if(a.years.length>1||b.years.length>1)warnings.push("At least one dataset carries multiple year/version tokens ("+a.years.join(", ")+" vs "+b.years.join(", ")+"); distinguish publication, observation and boundary/reference vintages before assuming alignment.");
  if(sharedIds.length){
    const exact=sharedIds.filter(id=>ab.find(x=>x.identifier===id)?.strength==="exact"&&bb.find(x=>x.identifier===id)?.strength==="exact");
    const ids=exact.length?exact:sharedIds;
    if(a.temporal!==b.temporal&&a.temporal!=="unspecified"&&b.temporal!=="unspecified")warnings.push("Temporal grains differ ("+a.temporal+" vs "+b.temporal+"); align periods before joining.");
    if(leftOnly.length||rightOnly.length)warnings.push("The datasets have extra dimensions on one or both sides; validate cardinality before joining.");
    return{status:"identifier",label:exact.length?"Shared identifier candidate":"Qualified shared namespace",confidence:exact.length?"strong inferred":"qualified inferred",operation:"validate_then_join",cardinality:leftOnly.length||rightOnly.length?"potential n:m":"potential 1:1",key:ids.join(" + "),namespace:ids.map(id=>IDENTIFIER_REGISTRY.find(x=>x.id===id)?.namespace||id).join(" · "),steps:["validate identifier namespace/version",...(a.temporal!==b.temporal?["align temporal grain"]:[]),...(leftOnly.length?["decide whether to aggregate left-only dimensions: "+leftOnly.join(", ")]:[]),...(rightOnly.length?["decide whether to aggregate right-only dimensions: "+rightOnly.join(", ")]:[]),"join and assert observed cardinality"],warnings,lossiness:leftOnly.length||rightOnly.length?"possible":"none",commonDimensions:common,leftOnly,rightOnly};
  }
  const path=crosswalkPath(aIds,bIds);
  if(path.length){
    return{status:"crosswalk",label:"Crosswalk required",confidence:"qualified inferred",operation:"crosswalk_then_join",cardinality:path.map(x=>x.cardinality).join(" → "),key:path.map(x=>x.from+"→"+x.to).join(" · "),namespace:"crosswalk registry",steps:[...path.flatMap(x=>x.requires),...path.map(x=>x.operation),"validate resulting key uniqueness","join and assert cardinality"],warnings:[...warnings,...path.map(x=>x.caveat),...(path.some(x=>/m/.test(x.cardinality))?["Crosswalk path contains a one-to-many/many-to-many step; assert row multiplication explicitly."]:[])],lossiness:path.some(x=>x.lossiness!=="none"||/m/.test(x.cardinality))?"possible":"none",crosswalks:path,commonDimensions:common};
  }
  if(common.length){
    const spatialCommon=common.filter(x=>a.spatial.includes(x)&&b.spatial.includes(x));
    const temporalMismatch=a.temporal!==b.temporal&&a.temporal!=="unspecified"&&b.temporal!=="unspecified";
    const operation=(leftOnly.length||rightOnly.length)?"aggregate_to_common_grain":"align_dimensions";
    if(temporalMismatch)warnings.push("Temporal grains differ ("+a.temporal+" vs "+b.temporal+").");
    if(spatialCommon.length)warnings.push("Shared geographic labels/dimensions do not prove a shared code namespace.");
    return{status:"grain",label:(leftOnly.length||rightOnly.length)?"Aggregate to common grain":"Common-grain candidate",confidence:"inferred",operation,cardinality:"unknown until validation",key:common.join(" + "),namespace:"dimension semantics must be validated",steps:[...(temporalMismatch?["align/resample time"]:[]),...(leftOnly.length?["aggregate left over: "+leftOnly.join(", ")]:[]),...(rightOnly.length?["aggregate right over: "+rightOnly.join(", ")]:[]),"validate common dimension coding","compare/join at common grain"],warnings,lossiness:leftOnly.length||rightOnly.length?"high":"possible",commonDimensions:common,leftOnly,rightOnly};
  }
  if(a.hasGeometry&&b.hasGeometry)return{status:"spatial",label:"Spatial overlay candidate",confidence:"inferred",operation:"spatial_overlay",cardinality:"n:m",key:"geometry after CRS harmonisation",namespace:"spatial",steps:["verify CRS and geometry validity","choose overlay predicate","measure unmatched/one-to-many overlays"],warnings:[...warnings,"Spatial coincidence does not establish semantic identity."],lossiness:"possible"};
  const ta=timeRank[a.temporal]??99,tb=timeRank[b.temporal]??99;
  if(ta<99&&tb<99&&left.sourceId===right.sourceId)return{status:"temporal",label:"Same-publisher temporal comparison",confidence:"inferred",operation:"resample_then_compare",cardinality:"n:m",key:"time after harmonisation",namespace:"same-publisher temporal context",steps:["align timezone/period","resample to compatible temporal grain","compare measures without implying entity identity"],warnings:[...warnings,"Time alignment alone is not a record join."],lossiness:"high"};
  return{status:"context",label:"No defensible join contract",confidence:"inferred",operation:"manual_research",cardinality:"unknown",key:"none",namespace:"none",steps:["inspect publisher schemas and identifiers","add an explicit relationship only when evidence supports it"],warnings:[...warnings,"Do not join on similarly named text fields without a namespace contract."],lossiness:"unknown"};
}
