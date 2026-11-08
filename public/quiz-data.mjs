export const QUIZ_MODES = [
  {id:"daily",name:"Daily Circuit",subtitle:"5 questions · changes every day",count:5,filter:"all",icon:"◒",tone:"daily"},
  {id:"quick",name:"Quick Drill",subtitle:"10 adaptive questions",count:10,filter:"all",icon:"⚡",tone:"quick"},
  {id:"scenario",name:"Field Missions",subtitle:"8 practical scenarios",count:8,filter:"scenario",icon:"◎",tone:"scenario"},
  {id:"joins",name:"Join Gym",subtitle:"10 identifiers & bridges",count:10,filter:"joins",icon:"⇄",tone:"joins"},
  {id:"boss",name:"Boss Run",subtitle:"10 hard questions · 3 lives",count:10,filter:"hard",icon:"◆",tone:"boss"},
  {id:"review",name:"Mistake Lab",subtitle:"Retry things you missed",count:10,filter:"mistakes",icon:"↺",tone:"review"}
];

export const CURATED_QUESTIONS = [
  {
    id:"s01",kind:"single",category:"Reuse",difficulty:2,
    prompt:"You need a daily reusable file of active Belgian enterprises for an automated pipeline. What is the best starting product?",
    options:[
      ["A","KBO / BCE Public Search"],
      ["B","CBE / KBO Open Data"],
      ["C","FSMA Data Portal"],
      ["D","NBB annual-account web services"]
    ],correct:["B"],
    explanation:"Public Search is designed for targeted consultation. KBO Open Data is the separate reusable product with daily CSV extracts for enterprises and establishment units.",
    sourceId:"kbo-open",why:"Choose the access product that matches the workload, not merely the authority that owns the data."
  },
  {
    id:"s02",kind:"single",category:"Joins",difficulty:2,
    prompt:"You verified a Belgian company in KBO and now want its filed annual accounts from NBB. Which join key should you preserve?",
    options:[
      ["A","Enterprise number"],
      ["B","Municipality name"],
      ["C","GTFS stop_id"],
      ["D","Statistical-sector code"]
    ],correct:["A"],
    explanation:"The enterprise number is the clean documented bridge from KBO company identity to NBB annual-account filings.",
    sourceId:"nbb",why:"Entity identifiers should survive landing and modelling layers unchanged whenever possible."
  },
  {
    id:"s03",kind:"single",category:"Geography",difficulty:3,
    prompt:"In Flanders, you receive a free-text address and need both canonical identity and detailed base-map geometry. Which sequence is strongest?",
    options:[
      ["A","GRB first, then guess the address from geometry"],
      ["B","Basisregisters first, then GRB"],
      ["C","Statbel first, then NBB.Stat"],
      ["D","Geopunt only, using the displayed label as the key"]
    ],correct:["B"],
    explanation:"Basisregisters resolves canonical address, street, municipality, building or parcel identifiers. GRB then supplies detailed reference geometry.",
    sourceId:"basisregisters",why:"Resolve semantic identity before attaching geometry."
  },
  {
    id:"s04",kind:"truefalse",category:"Semantics",difficulty:3,
    prompt:"A Flemish agricultural declaration parcel can safely be treated as the same real-world object as a cadastral parcel whenever their polygons overlap.",
    options:[["true","True"],["false","False"]],correct:["false"],
    explanation:"Agricultural declaration parcels and cadastral parcels represent different concepts. Spatial overlap does not make their identifiers or semantics interchangeable.",
    sourceId:"landbouw-percelen",why:"Geometry that overlaps is not automatically semantic identity."
  },
  {
    id:"s05",kind:"single",category:"Pipelines",difficulty:3,
    prompt:"You are automating an NBB.Stat extraction. What should you keep alongside the observation values?",
    options:[
      ["A","Only the displayed column labels"],
      ["B","The SDMX dataset key and structure metadata"],
      ["C","A screenshot of the chart"],
      ["D","Only the download timestamp"]
    ],correct:["B"],
    explanation:"NBB.Stat is dimension-based. Dataset keys and structure metadata keep dimension codes interpretable and make extracts reproducible.",
    sourceId:"nbb-stat",why:"For dimensional APIs, metadata is part of the dataset contract."
  },
  {
    id:"s06",kind:"single",category:"Joins",difficulty:3,
    prompt:"You combine a static GTFS feed with a provider's realtime feed. Which identifiers deserve special protection?",
    options:[
      ["A","stop_id, trip_id and route_id"],
      ["B","NIS and NACE-BEL"],
      ["C","CaPaKey and GRB object ID"],
      ["D","SDMX dataset key and pollutant code"]
    ],correct:["A"],
    explanation:"GTFS static and realtime integration relies on feed/provider-scoped transport identifiers such as stop_id, trip_id and route_id.",
    sourceId:"transportdata",why:"Realtime enrichment only works when the identifiers from the static schedule remain stable within the provider/feed context."
  },
  {
    id:"s07",kind:"single",category:"Semantics",difficulty:3,
    prompt:"You align Elia electricity-load data with IRCEL air-quality observations by time and geography. Which conclusion is safe?",
    options:[
      ["A","Matching timestamps prove electricity load caused the pollutant change"],
      ["B","The aligned series can support analysis, but correlation alone does not prove causation"],
      ["C","The sources cannot be compared because they are from different agencies"],
      ["D","Station code is a universal Belgian energy identifier"]
    ],correct:["B"],
    explanation:"Time and geography make the series analyzable together, but observational alignment does not establish a causal mechanism.",
    sourceId:"ircel",why:"A technically valid join can still support an invalid interpretation."
  },
  {
    id:"s08",kind:"single",category:"Geography",difficulty:2,
    prompt:"You are joining municipality statistics to a regional map. Which field is safer than municipality name?",
    options:[
      ["A","NIS code"],
      ["B","Postal marketing label"],
      ["C","Publisher display title"],
      ["D","The first five characters of the street name"]
    ],correct:["A"],
    explanation:"NIS codes are canonical administrative identifiers used to bridge statistics and regional geography more safely than names.",
    sourceId:"statbel",why:"Labels change and collide; canonical codes are designed to identify."
  },
  {
    id:"s09",kind:"single",category:"Sources",difficulty:2,
    prompt:"Which pairing best describes the roles of GRB and Geopunt?",
    options:[
      ["A","GRB = detailed reference geometry; Geopunt = broader thematic geospatial entry point"],
      ["B","GRB = company register; Geopunt = financial filing API"],
      ["C","GRB = timetable feed; Geopunt = realtime rail feed"],
      ["D","GRB = macroeconomic database; Geopunt = business lookup"]
    ],correct:["A"],
    explanation:"GRB is detailed reference-map geometry, while Geopunt is a wider Flemish portal for map layers, datasets and thematic context.",
    sourceId:"grb",why:"Know whether you need canonical base geometry or thematic context."
  },
  {
    id:"s10",kind:"single",category:"Sources",difficulty:2,
    prompt:"You find a promising dataset in data.gov.be. What is usually the strongest next step for production integration?",
    options:[
      ["A","Stay on the catalogue page and scrape its HTML"],
      ["B","Follow the record to the publishing authority and use the publisher's technical access route"],
      ["C","Replace the dataset with a similarly named commercial source"],
      ["D","Infer an API endpoint from the dataset title"]
    ],correct:["B"],
    explanation:"data.gov.be is primarily a discovery layer. The actual file, API or service generally lives with the publishing authority.",
    sourceId:"datagov",why:"Discovery metadata tells you where to go; it is not necessarily the runtime endpoint."
  },
  {
    id:"s11",kind:"multi",category:"Reuse",difficulty:3,
    prompt:"You are preparing a production integration. Select every warning sign that deserves investigation before launch.",
    options:[
      ["A","The source is exposed only as a public lookup page"],
      ["B","The pipeline discards official identifiers after matching names"],
      ["C","The source has a documented reusable API or download product"],
      ["D","The join mixes classification versions without recording them"]
    ],correct:["A","B","D"],
    explanation:"Lookup-only access, discarded identifiers and mixed classification versions are all integration risks. A documented reusable interface is generally a positive signal, not a warning by itself.",
    why:"Production readiness is as much about access and metadata discipline as about code."
  },
  {
    id:"s12",kind:"single",category:"Sources",difficulty:3,
    prompt:"After KBO identifies a financial company, which source is specifically useful for checking regulated status or authorisation?",
    options:[
      ["A","FSMA Data Portal"],
      ["B","GRB OGC API Features"],
      ["C","Elia Open Data"],
      ["D","IRCEL open data"]
    ],correct:["A"],
    explanation:"FSMA publishes official regulatory lists for authorisations, registrations, listed companies and related financial-market records.",
    sourceId:"fsma",why:"A general company register and a sector regulator answer different questions."
  },
  {
    id:"s13",kind:"single",category:"Geography",difficulty:3,
    prompt:"A file contains coordinates in EPSG:31370. What should you assume before overlaying them on longitude/latitude web-map data?",
    options:[
      ["A","They are already WGS84 longitude and latitude"],
      ["B","They are Belgian Lambert 72 projected coordinates and need appropriate CRS handling"],
      ["C","They are GTFS stop identifiers"],
      ["D","They are municipality NIS codes encoded as numbers"]
    ],correct:["B"],
    explanation:"EPSG:31370 is Belgian Lambert 72, a projected coordinate reference system. It should not be treated as longitude/latitude without transformation.",
    why:"Coordinate numbers are meaningless without their CRS."
  },
  {
    id:"s14",kind:"multi",category:"Geography",difficulty:3,
    prompt:"You are joining population statistics across time to administrative geometries. Select every practice that improves reproducibility.",
    options:[
      ["A","Keep the NIS or statistical-sector code"],
      ["B","Keep the period and boundary vintage"],
      ["C","Join solely on the displayed municipality name"],
      ["D","Record which geographic source/version supplied the geometry"]
    ],correct:["A","B","D"],
    explanation:"Canonical codes, temporal/boundary vintage and source provenance make historical geographic joins explainable. Name-only joins are fragile.",
    sourceId:"statbel",why:"Administrative boundaries and labels can evolve; a join needs temporal context."
  },
  {
    id:"s15",kind:"single",category:"Joins",difficulty:3,
    prompt:"You want to move analytically from KBO Open Data company activities to aggregate sector statistics in NBB.Stat. Which bridge is strongest?",
    options:[
      ["A","NACE-BEL"],
      ["B","GTFS route_id"],
      ["C","Pollutant code"],
      ["D","GRB collection ID"]
    ],correct:["A"],
    explanation:"NACE-BEL connects enterprise activity classification to aggregate sector statistics when classification versions are aligned.",
    sourceId:"kbo-open",why:"A classification can be a bridge between entity-level and aggregate data without pretending the grains are identical."
  },
  {
    id:"s16",kind:"single",category:"Pipelines",difficulty:3,
    prompt:"Your builder stack includes a source that is useful only through an interactive lookup UI, but you selected 'Production integration'. What should the readiness check do?",
    options:[
      ["A","Treat the lookup page as automatically machine-ready"],
      ["B","Flag it as a blocker or require a reusable access product"],
      ["C","Ignore the access method because the publisher is official"],
      ["D","Convert the HTML title into an API endpoint"]
    ],correct:["B"],
    explanation:"Authority and machine-readiness are separate. A production workflow needs a reusable access method or an explicit alternative.",
    why:"A trustworthy source can still be the wrong technical interface."
  },
  {
    id:"s17",kind:"single",category:"Sources",difficulty:2,
    prompt:"What is the best mental model for geo.be?",
    options:[
      ["A","A federal discovery point for geographic information and services"],
      ["B","A daily company CSV product"],
      ["C","A rail punctuality warehouse"],
      ["D","An air-quality station API only"]
    ],correct:["A"],
    explanation:"geo.be is a federal discovery portal for Belgian geographic information, metadata and geospatial resources from public institutions.",
    sourceId:"geobe",why:"Discovery layers help you find the authoritative geospatial service; they are not always the final endpoint."
  },
  {
    id:"s18",kind:"single",category:"Sources",difficulty:3,
    prompt:"For Belgian rail analysis, which combination best separates timetable discovery from rail infrastructure/performance context?",
    options:[
      ["A","transportdata.be + Infrabel Open Data"],
      ["B","KBO Open Data + FSMA"],
      ["C","Elia + NBB.Stat"],
      ["D","Basisregisters + Statbel"]
    ],correct:["A"],
    explanation:"transportdata.be is the national mobility access point for feeds such as GTFS/NeTEx, while Infrabel exposes rail infrastructure and performance datasets.",
    sourceId:"infrabel",why:"Adjacent domains often need two complementary sources rather than one all-purpose portal."
  },
  {
    id:"s19",kind:"truefalse",category:"Reuse",difficulty:2,
    prompt:"Because KBO Public Search is publicly accessible, it is automatically the preferred interface for systematic bulk reuse.",
    options:[["true","True"],["false","False"]],correct:["false"],
    explanation:"Public accessibility does not define the reuse interface. KBO Open Data is the separate product intended for reusable bulk extracts, subject to its own terms.",
    sourceId:"kbo-open",why:"Publicly viewable and programmatically reusable are different properties."
  },
  {
    id:"s20",kind:"truefalse",category:"Joins",difficulty:2,
    prompt:"A documented source-to-source bridge can still require you to verify grain, time period or classification version before joining.",
    options:[["true","True"],["false","False"]],correct:["true"],
    explanation:"A valid key tells you how records can relate; it does not guarantee that temporal scope, grain or classification version are compatible.",
    why:"Joinability is necessary but not sufficient for analytical validity."
  },
  {
    id:"s21",kind:"multi",category:"Semantics",difficulty:3,
    prompt:"Which statements correctly distinguish identity from context? Select every correct statement.",
    options:[
      ["A","Basisregisters object IDs can identify canonical registry objects"],
      ["B","A Geopunt thematic layer automatically becomes the canonical identity of every mapped object"],
      ["C","GRB can provide detailed reference geometry without replacing the semantic identity from a registry"],
      ["D","A spatial overlap alone proves two source objects are identical"]
    ],correct:["A","C"],
    explanation:"Registry identifiers provide semantic identity; reference or thematic geometry adds spatial representation and context. Neither map display nor overlap alone proves identity.",
    sourceId:"basisregisters",why:"The same place can be represented by several layers with different object semantics."
  },
  {
    id:"s22",kind:"single",category:"Pipelines",difficulty:3,
    prompt:"You want a reproducible handoff from a source stack to another engineer. Which export is most valuable?",
    options:[
      ["A","Only source names"],
      ["B","Source URLs, access modes, join keys, cautions and documented bridges"],
      ["C","A screenshot of the network graph"],
      ["D","Only the final dashboard title"]
    ],correct:["B"],
    explanation:"A reusable handoff needs provenance, access route, identifiers, integration cautions and relationship logic—not just labels.",
    why:"The project plan should preserve the reasoning needed to reproduce the integration."
  },
  {
    id:"s23",kind:"single",category:"Geography",difficulty:3,
    prompt:"You need to compare declared agricultural land use with cadastral information. What is the safest modelling approach?",
    options:[
      ["A","Treat declaration parcel ID as a cadastral parcel ID"],
      ["B","Keep the two parcel concepts separate and relate them spatially or through explicit mappings"],
      ["C","Discard geometry and join on crop name"],
      ["D","Replace both with municipality name only"]
    ],correct:["B"],
    explanation:"Agricultural declarations and cadastral parcels have different semantics. Model them as distinct entities and use an explicit spatial or mapped relationship where needed.",
    sourceId:"landbouw-percelen",why:"A model can link two concepts without collapsing them into one."
  },
  {
    id:"s24",kind:"single",category:"Sources",difficulty:3,
    prompt:"You need canonical Flemish addresses, buildings, streets and parcel references through APIs. Which source best fits that role?",
    options:[
      ["A","Basisregisters Vlaanderen API"],
      ["B","NBB.Stat"],
      ["C","FSMA Data Portal"],
      ["D","Infrabel Open Data"]
    ],correct:["A"],
    explanation:"Basisregisters provides canonical Flemish registry APIs for addresses, streets, municipalities, buildings, roads and parcels.",
    sourceId:"basisregisters",why:"Choose the registry system for canonical object identity, then enrich elsewhere."
  }
];

export const BADGES = [
  {id:"join",name:"Key Keeper",category:"Joins",threshold:70,min:5,mark:"⌘",description:"70%+ mastery on joins after 5 answers"},
  {id:"reuse",name:"Reuse Police",category:"Reuse",threshold:70,min:5,mark:"R",description:"70%+ mastery on access & reuse after 5 answers"},
  {id:"geo",name:"Map Whisperer",category:"Geography",threshold:70,min:5,mark:"◇",description:"70%+ mastery on geographic data after 5 answers"},
  {id:"pipe",name:"Pipeline Architect",category:"Pipelines",threshold:75,min:5,mark:"↯",description:"75%+ mastery on production pipelines after 5 answers"},
  {id:"sage",name:"Data Desk Sage",totalCorrect:50,mark:"★",description:"50 correct answers overall"}
];