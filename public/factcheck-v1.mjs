export const FACTCHECKED_AT = "2026-09-30";

export const SOURCE_OVERRIDES = {
  statbel: {
    summary: "Statbel's open-data catalogue publishes reusable non-personal statistics and dataset-specific geographic files; formats, periods and geographic vintages vary by dataset.",
    note: "Do not treat 'NIS code' or 'statistical sector' as timeless universal keys. Statistical-sector boundaries are versioned, and Statbel notes that from 01/01/2019 the municipality code can no longer simply be derived from the statistical-sector code.",
    evidence: [
      ["Statbel Open Data","https://statbel.fgov.be/en/open-data"],
      ["Statistical sectors 2026","https://statbel.fgov.be/en/open-data/statistical-sectors-2026"],
      ["Statistical sectors 2023 — coding warning","https://statbel.fgov.be/en/open-data/statistical-sectors-2023"]
    ],
    verifiedNote: "Verified at dataset level: preserve period, CRS, code-table version and boundary vintage together."
  },
  datagov: {
    access: ["Catalogue","Metadata API"],
    formats: ["DCAT-AP","RDF/XML","N-Triples","Linked Data metadata"],
    summary: "Federal discovery and metadata aggregation portal. It generally points to datasets hosted by the publishing authority rather than storing the data files itself.",
    note: "A catalogue record is not automatically a downloadable file, stable API or production SLA. Follow the distribution and publisher metadata to the actual source.",
    evidence: [
      ["Data.gov.be FAQ","https://data.gov.be/nl/documentatie/veelgestelde-vragen"],
      ["Data.gov.be API / metadata","https://data.gov.be/de/api"]
    ],
    verifiedNote: "The portal explicitly says it contains links to open-data files; the files remain hosted and managed by public services."
  },
  kbo: {
    summary: "Authoritative targeted Public Search for CBE/KBO entities and establishment units. Results are for consultation; Public Search data reuse is explicitly prohibited.",
    note: "Public Search is entity-by-entity targeted consultation (maximum 200 results per search). For reuse, FPS Economy offers separate Open Data, paid Public Search web services and a broader licensed reuse file.",
    evidence: [
      ["CBE Public Search","https://economie.fgov.be/en/themes/enterprises/crossroads-bank-enterprises/services-everyone/consultation-and-research-data/cbe-public-search"],
      ["Public data available for reuse","https://economie.fgov.be/en/themes/enterprises/crossroads-bank-enterprises/services-everyone/public-data-available-reuse"]
    ],
    verifiedNote: "Public visibility and legal/technical reusability are separate properties."
  },
  "kbo-open": {
    summary: "Free reuse product containing limited active CBE data in a complete CSV plus daily change file; active registered entities and establishment units are included.",
    note: "Files are made available daily and remain accessible for 31 days. Registration and acceptance of terms are required; SFTP access requires a request. This is not the broader active-and-discontinued reuse file.",
    evidence: [
      ["CBE Open Data","https://economie.fgov.be/en/themes/enterprises/crossroads-bank-enterprises/services-everyone/public-data-available-reuse/cbe-open-data"],
      ["CBE reuse options","https://economie.fgov.be/en/themes/enterprises/crossroads-bank-enterprises/services-everyone/public-data-available-reuse"]
    ],
    verifiedNote: "There are three reuse routes with different breadth, price and access mechanics."
  },
  nbb: {
    formats: ["PDF","XBRL","JSON","API"],
    summary: "Central Balance Sheet Office professional web services for published annual-account filing references and documents. The service family contains multiple products rather than one generic anonymous API.",
    note: "Five web-service types are offered. Registration/subscription is required; some improved-data products are paid. Older filings are not always available as XBRL, and JSON derived from XBRL is unavailable for filings predating its 2022 introduction.",
    evidence: [
      ["NBB CBSO web services","https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services"],
      ["Developer/test operations","https://www.nbb.be/en/central-balance-sheet-office/consultation/web-services/test-environment-developer-portal"]
    ],
    verifiedNote: "Enterprise number is supported in the Authentic Data Query legalEntity route, but document availability depends on publication eligibility and format history."
  },
  "nbb-stat": {
    summary: "NBB.Stat is the Bank's statistical dissemination portal, covering NBB data and datasets from other Belgian/international institutions. Downloads and developer API access are dataset/dimension driven.",
    note: "Do not treat NACE-BEL as a platform-wide join key. It is dataset-specific. For example, the NBB annual-account aggregate statistics page documents NACE-BEL 2008 for financial years 2009–2018. The .Stat API uses SDMX-structured queries with output serialisations such as JSON, CSV and XML.",
    evidence: [
      ["NBB.Stat data explorer","https://www.nbb.be/en/statistics/topics/general/online-statistical-database"],
      ["Annual-account statistics in NBB.Stat","https://www.nbb.be/en/central-balance-sheet-office/consultation/statistics-annual-accounts-nbbstat"]
    ],
    verifiedNote: "Dataset structure, revisions, units, coverage and observation-status metadata belong in any reproducible extract."
  },
  fsma: {
    formats: ["Web records","JSON export","Documents"],
    summary: "Sector-regulatory portal containing FSMA-maintained authorisation, enrolment and registration lists plus securities, listed-company and managers' transaction information.",
    note: "For Belgian regulated parties, records can expose the Belgian enterprise number and an FSMA number, which can support an exact KBO cross-check. Coverage is regulatory and category-specific, not a general register of all Belgian companies.",
    evidence: [
      ["FSMA Data Portal","https://www.fsma.be/en/data-portal"],
      ["Example Belgian party record with enterprise number / JSON export","https://www.fsma.be/en/party/check"]
    ],
    verifiedNote: "An absent result in one FSMA list is not evidence that an entity is unregulated under every possible regime."
  },
  transportdata: {
    summary: "Belgium's National Access Point for ITS, implemented as a CKAN catalogue of datasets and services across transport domains. The catalogue itself is machine-queryable; resource access is provider-specific.",
    note: "GTFS, GTFS-Realtime, NeTEx, GBFS, DATEX II, JSON, XML and other formats occur in catalogue records, but access terms, rate limits, licences, credentials, update frequency and SLA vary per publisher/resource.",
    evidence: [
      ["transportdata.be home / NAP scope","https://transportdata.be/en/"],
      ["Dataset catalogue","https://transportdata.be/dataset/"],
      ["De Lijn GTFS Realtime limits example","https://transportdata.be/en/dataset/gtfs-realtime-v2"]
    ],
    verifiedNote: "Do not promote provider-scoped GTFS identifiers to national identifiers, and do not assume a generic GTFS-to-Infrabel crosswalk."
  },
  basisregisters: {
    summary: "Official API surface for the Flemish building/address registers and road register, including streets, addresses, buildings, building units and parcel references.",
    note: "Object identifiers are register-specific. Parcel lookup accepts the CaPaKey or its slash-to-hyphen object-id form. List endpoints are bounded and rate-limited; the documentation explicitly points bulk consumers to download products.",
    evidence: [
      ["Basisregisters API documentation","https://docs.basisregisters.vlaanderen.be/docs/api-documentation.html"]
    ],
    verifiedNote: "The API exposes explicit relationships between some registry objects, but those identifiers should not be assumed to equal GRB feature identifiers."
  },
  grb: {
    summary: "OGC API Features access to GRBgis collections in the Grootschalig Referentiebestand, with collection-specific schemas and queryable features.",
    note: "GRB is a reference-map object model. For example, its ADP administrative parcel is described as a graphical representation of the presumed location of a cadastral parcel; that wording matters. Do not treat a GRB feature ID as a legal cadastral identifier or as a Basisregisters object ID without a documented mapping.",
    evidence: [
      ["GRB OGC API Features","https://geo.api.vlaanderen.be/GRB/ogc/features/v1"],
      ["GRB collections / ADP definition","https://geo.api.vlaanderen.be/GRB/ogc/features/v1/collections?f=text%2Fhtml"]
    ],
    verifiedNote: "The service's published data CRS is EPSG:31370 for these collections; client output/transform rules should be read from the API."
  },
  "landbouw-percelen": {
    formats: ["GeoPackage","Geodata","Analysis tables"],
    summary: "Agricultural-use parcel declarations published for analysis, with campaign-year data and crop/land-use attributes; this is not the cadastral parcel register.",
    note: "Since 2020 the extended download is published three times per campaign: early and October snapshots are provisional, while the March publication in year X+1 is the final campaign dataset. Preserve snapshot/campaign status in analysis.",
    evidence: [
      ["Flemish agricultural-use parcels","https://landbouwcijfers.vlaanderen.be/open-geodata-landbouwgebruikspercelen"]
    ],
    verifiedNote: "Parcel geometry can be spatially compared with other layers, but spatial overlap is not an identity key."
  },
  infrabel: {
    summary: "Infrabel's OpenDataSoft portal publishes rail-infrastructure and performance datasets with dataset-specific APIs/exports. Several infrastructure datasets explicitly document internal relationships to one another.",
    note: "Use the identifiers documented by each Infrabel dataset. For example, kilometre-marker ↔ main-track relationships have explicit kpp_id/track_id fields. No generic direct identifier bridge from transport-operator GTFS feeds to Infrabel infrastructure is asserted here.",
    evidence: [
      ["Track segments","https://opendata.infrabel.be/explore/dataset/geografische-positie-van-alle-spoorsegmenten/"],
      ["Kilometre marker ↔ main track relation","https://opendata.infrabel.be/explore/dataset/relatie-tussen-kilometerpalen-en-lijnen/"]
    ],
    verifiedNote: "Many infrastructure geometries are managed in Lambert 72; web-map views may be transformed to WGS84 with some loss of precision."
  },
  elia: {
    summary: "Elia's OpenDataSoft portal exposes electricity-system datasets through dataset-specific APIs and exports, including total load and generation aggregated by fuel type.",
    note: "Do not model 'Elia load' as one timeless series. Dataset definitions, resolution and historical/near-real-time variants matter. Elia currently warns that the 'Load on the Elia grid' dataset may have a publication issue and recommends Total load instead.",
    evidence: [
      ["Total generation by fuel type","https://opendata.elia.be/explore/dataset/ods201/"],
      ["Load on Elia grid — publisher warning","https://opendata.elia.be/explore/dataset/ods003/"],
      ["Measured/forecast total load","https://opendata.elia.be/explore/dataset/ods001/api/"]
    ],
    verifiedNote: "Use dataset identifier + datetime + resolution + dataset-specific dimensions; 'ENTSO-E fuel type' applies to particular datasets, not every Elia dataset."
  },
  ircel: {
    formats: ["WFS","CSV","GeoTIFF","FTP","Open-data endpoints"],
    summary: "IRCEL/CELINE publishes air-quality data through open-data endpoints under CC BY 4.0, including station-oriented WFS/CSV access and model outputs at different spatial/temporal resolutions.",
    note: "Keep measurement stations, modelled surfaces and exposure concepts distinct. A station/time/pollutant record can be joined to station metadata; model rasters and municipality aggregates require different keys and interpretation.",
    evidence: [
      ["IRCEL open data","https://www.irceline.be/en/documentation/open-data"]
    ],
    verifiedNote: "The publisher explicitly exposes both station-style WFS data and modelled outputs, so 'air-quality data' is not one homogeneous grain."
  },
  wallonia: {
    summary: "Official Walloon catalogue for geographic datasets, web services, interactive maps and—where offered—downloads.",
    note: "Access and reuse conditions are resource-specific. The portal recommends web services/interactive maps when freshness matters; direct download is not available for every resource and can require an account.",
    evidence: [
      ["Wallonia maps & data","https://geoportail.wallonie.be/cartes-et-donnees"],
      ["Download guidance / conditions","https://geoportail.wallonie.be/telecharger"]
    ],
    verifiedNote: "A catalogue item, web service, interactive map and downloadable copy are distinct publication products."
  },
  geobe: {
    summary: "Belgian geographic metadata/discovery catalogue operated by the National Geographic Institute, exposing metadata records for view, download, discovery and application services.",
    note: "Treat geo.be primarily as a discovery/metadata layer. A metadata record can point to a service, but the data owner, protocol, licence and operational behaviour belong to the referenced resource.",
    evidence: [
      ["geo.be service catalogue","https://publish.geo.be/geonetwork/srv/search?type=service"]
    ],
    verifiedNote: "Discovery relationship is not the same thing as a record-level data join."
  },
  datavlaanderen: {
    summary: "Flemish semantic standards and interoperability ecosystem, including OSLO standards and DCAT profiles for describing datasets, distributions and data services.",
    note: "A standard or vocabulary defines semantics and exchange structure; it is not automatically an operational dataset or API endpoint.",
    evidence: [
      ["OSLO DCAT metadata vocabulary","https://data.vlaanderen.be/standaarden/vocabularium-metadata-dcat"]
    ],
    verifiedNote: "Useful for contracts and semantics; availability of actual data remains source-specific."
  }
};

export const GUIDANCE_OVERRIDES = {
  statbel: {
    keys:["NIS code (dataset/version specific)","Statistical-sector code","Dataset period / boundary vintage"],
    joins:["Use NIS/statistical-sector identifiers only with the relevant code table and vintage.","Spatial joins remain necessary when a target layer does not expose a compatible administrative code."],
    caution:"From 01/01/2019, do not derive municipality code mechanically from the statistical-sector code. Boundary and sector reforms make vintage explicit."
  },
  datagov: {
    keys:["Dataset URI / catalogue identifier","Publisher","Distribution or service link"],
    joins:["Use catalogue metadata to discover the publisher/distribution; it is not an analytical join key."],
    caution:"The portal usually stores metadata and links, not the source data file."
  },
  kbo: {
    keys:["Enterprise number","Establishment-unit number"],
    joins:["Enterprise number can be used for exact cross-checks with systems that explicitly expose the same Belgian enterprise number."],
    caution:"Public Search reuse is prohibited. Use one of the dedicated reuse products for automated/systematic reuse."
  },
  "kbo-open": {
    keys:["Enterprise number","Establishment-unit number","Activity classification + version"],
    joins:["Enterprise number is an entity identifier; activity codes are classifications and require version/grain checks."],
    caution:"Open Data is limited to active-data scope. Do not infer discontinued-history coverage from it."
  },
  nbb: {
    keys:["Enterprise number in legalEntity queries","Deposit reference","Document format/taxonomy"],
    joins:["Enterprise number supports entity-level lookup from KBO to CBSO filing references where a filing is eligible for publication."],
    caution:"Availability of PDF/XBRL/JSON representations depends on filing age and service product."
  },
  "nbb-stat": {
    keys:["Dataset identifier","Dimension codes","Time/frequency","Classification version where present"],
    joins:["Only use NACE-BEL when the chosen dataset actually exposes the compatible classification/version."],
    caution:"NBB.Stat is a multi-dataset dissemination platform, not one universal schema."
  },
  fsma: {
    keys:["Enterprise number when present","FSMA number","LEI where applicable"],
    joins:["For Belgian party records exposing enterprise number, cross-check that number with KBO."],
    caution:"FSMA coverage is regulatory and list-specific; not every company or financial relationship is represented."
  },
  transportdata: {
    keys:["CKAN dataset/service ID","Publisher","Provider/feed-scoped IDs"],
    joins:["GTFS static/realtime IDs can relate records when the publisher documents that the realtime feed refers to the corresponding static feed."],
    caution:"stop_id/trip_id/route_id are not national universal identifiers. Provider access conditions vary."
  },
  basisregisters: {
    keys:["Address/street/building object ID","Municipality NIS code in relevant endpoints","CaPaKey / parcel object ID"],
    joins:["Use explicit API links/fields between Basisregisters objects; preserve the actual register identifier."],
    caution:"Do not assume Basisregisters object IDs are GRB feature IDs."
  },
  grb: {
    keys:["Collection ID","Feature ID within collection","Geometry / CRS"],
    joins:["Use collection schema and explicit attributes. Spatial relation to another register is not automatically an identity mapping."],
    caution:"ADP is a graphical/administrative representation of cadastral parcel location, not a blanket legal cadastral identity key."
  },
  "landbouw-percelen": {
    keys:["Campaign year / snapshot","Geometry","Crop/land-use attributes","Administrative geography where supplied"],
    joins:["Aggregate or spatially overlay only after preserving campaign/snapshot semantics."],
    caution:"Agricultural-use declarations and cadastral/reference-map parcels are distinct object concepts."
  },
  infrabel: {
    keys:["Dataset identifier","Dataset-specific feature ID","Explicit relation fields such as kpp_id/track_id","CRS"],
    joins:["Prefer explicitly documented Infrabel relation datasets for infrastructure-to-infrastructure links."],
    caution:"Do not assume GTFS operator IDs map directly to Infrabel infrastructure IDs."
  },
  elia: {
    keys:["Dataset ID","Datetime","Resolution code","Dataset-specific dimensions"],
    joins:["Time alignment supports analysis across series; it does not create an entity-level join."],
    caution:"Dataset definitions and quality notices can change; current ODS003 warning is a concrete example."
  },
  ircel: {
    keys:["Station code + datetime + pollutant for station data","Model/layer + time for model outputs","Geometry / CRS"],
    joins:["Station coordinates can support spatial context; modelled rasters/aggregates require different handling."],
    caution:"Monitoring-station observations, modelled concentrations and human exposure are not interchangeable."
  },
  wallonia: {
    keys:["Dataset/service record ID","Service URL","Dataset-specific administrative code or geometry"],
    joins:["Use only identifiers exposed by the actual resource; otherwise use spatial alignment."],
    caution:"Portal metadata does not imply a universal join key across Walloon datasets."
  },
  geobe: {
    keys:["Metadata record identifier","Service URL","Dataset-specific identifiers"],
    joins:["Use geo.be to discover the actual resource, then apply the source dataset's own identifiers."],
    caution:"A discovery catalogue relationship is not an analytical join."
  },
  geopunt: {
    keys:["Layer/dataset identifier","Dataset-specific fields","Geometry / CRS"],
    joins:["Geopunt is a portal/context layer; whether NIS codes are available depends on the selected dataset."],
    caution:"Do not treat 'NIS / coordinates' as a universal Geopunt join contract."
  }
};

export const RELATIONSHIPS = [
  {
    from:"kbo",to:"nbb",key:"Enterprise number",purpose:"Entity identity → published annual-account filing references",kind:"direct_identifier",label:"Direct identifier",score:95,identityPreserving:true,recordLevel:true,
    caution:"Only filings eligible for publication are exposed, and representation availability depends on filing age/product.",
    evidence:"NBB Authentic Data Query exposes legalEntity/{enterprise-number}/references."
  },
  {
    from:"kbo",to:"fsma",key:"Belgian enterprise number (when present)",purpose:"Company identity → sector-regulatory record",kind:"regulatory_crosscheck",label:"Conditional exact cross-check",score:88,identityPreserving:true,recordLevel:true,
    caution:"FSMA is sector/list specific. Absence from a given result/list is not proof of no regulation.",
    evidence:"Belgian FSMA party pages can expose enterprise number and JSON export."
  },
  {
    from:"kbo-open",to:"nbb-stat",key:"NACE-BEL only when same version/scope exists",purpose:"Entity activity classification → selected aggregate sector statistics",kind:"classification_alignment",label:"Dataset-specific classification",score:55,identityPreserving:false,recordLevel:false,
    caution:"Not a record-level join. NBB.Stat is multi-dataset; the annual-account aggregate page specifically documents NACE-BEL 2008 for 2009–2018.",
    evidence:"Use only after verifying both datasets' classification version, time and grain."
  },
  {
    from:"statbel",to:"geopunt",key:"Dataset-specific NIS code or spatial geometry",purpose:"Statistics ↔ Flemish thematic geography",kind:"spatial_context",label:"Dataset-dependent spatial/admin alignment",score:45,identityPreserving:false,recordLevel:false,
    caution:"Geopunt does not provide one universal NIS-coded schema; inspect the chosen layer.",
    evidence:"Statbel publishes versioned NIS/statistical-sector geographies; Geopunt is a multi-layer portal."
  },
  {
    from:"statbel",to:"wallonia",key:"Dataset-specific administrative code or geometry",purpose:"Statistics ↔ Walloon geographic resources",kind:"spatial_context",label:"Dataset-dependent spatial/admin alignment",score:45,identityPreserving:false,recordLevel:false,
    caution:"Resource fields and conditions vary by Walloon dataset/service.",
    evidence:"Wallonia separates catalogue records, services, maps and downloads."
  },
  {
    from:"basisregisters",to:"grb",key:"Explicit mapping if documented; otherwise spatial/semantic relation",purpose:"Registry identity ↔ reference-map geometry",kind:"complementary_models",label:"Complementary object models",score:35,identityPreserving:false,recordLevel:false,
    caution:"Do not assume Basisregisters object IDs and GRB feature IDs are interchangeable.",
    evidence:"Basisregisters and GRB expose distinct object models and identifiers."
  },
  {
    from:"grb",to:"geopunt",key:"Catalogue/layer relationship or geometry",purpose:"GRB reference layers ↔ Geopunt discovery/thematic context",kind:"catalogue_overlay",label:"Portal / overlay relationship",score:40,identityPreserving:false,recordLevel:false,
    caution:"This is not a record-level crosswalk.",
    evidence:"Geopunt exposes many layers; GRB is one reference-data family."
  },
  {
    from:"transportdata",to:"infrabel",key:"No generic direct key asserted",purpose:"Passenger-service/timetable data ↔ rail-infrastructure/performance context",kind:"contextual_analysis",label:"Contextual rail analysis",score:25,identityPreserving:false,recordLevel:false,
    caution:"Do not assume GTFS stop/trip/route IDs map to Infrabel track/operational-point IDs without a specific mapping.",
    evidence:"transportdata catalogues operator feeds; Infrabel documents its own infrastructure identifiers and internal relations."
  },
  {
    from:"elia",to:"ircel",key:"Time + geography only after harmonisation",purpose:"Electricity-system series ↔ air-quality context",kind:"contextual_analysis",label:"Contextual time/spatial analysis",score:20,identityPreserving:false,recordLevel:false,
    caution:"No entity-level join is implied; temporal/geographic correlation does not establish causality.",
    evidence:"Both sources expose time/geography but represent different physical systems and grains."
  },
  {
    from:"landbouw-percelen",to:"statbel",key:"Aggregate to compatible geography/time; definitions must be checked",purpose:"Parcel declarations ↔ official agricultural/statistical aggregates",kind:"aggregation_comparison",label:"Aggregation / comparison",score:35,identityPreserving:false,recordLevel:false,
    caution:"Not a parcel-level join. Campaign snapshot, population/universe and definitions can differ.",
    evidence:"Agricultural-use parcel declarations are a different source/process from Statbel aggregate statistics."
  }
];

export const QUIZ_OVERRIDES = {
  s03:{
    prompt:"You need canonical Flemish address identity and also want detailed GRB reference-map geometry. Which statement is most accurate?",
    options:[
      ["A","Basisregisters and GRB use one universal shared object ID, so either can replace the other"],
      ["B","Use Basisregisters for registry identity and GRB for its own reference-map objects; only crosswalk them where an explicit mapping or defensible spatial relation exists"],
      ["C","GRB feature IDs are cadastral legal identifiers by definition"],
      ["D","Municipality name is sufficient to equate any building/address feature across both systems"]
    ],correct:["B"],
    explanation:"Basisregisters and GRB expose different object models. Basisregisters gives persistent register identifiers and explicit registry relationships; GRB exposes collection-specific reference-map features. A direct ID equivalence must not be invented.",
    sourceId:"basisregisters",why:"Identity, geometry and cartographic representation are different layers of meaning."
  },
  s06:{
    prompt:"A provider explicitly documents that its GTFS-Realtime feed refers to its corresponding static GTFS feed. Which identifiers are commonly important for linking realtime entities back to that provider feed?",
    options:[
      ["A","stop_id, trip_id and route_id where used by that feed"],
      ["B","NIS code and NACE-BEL"],
      ["C","CaPaKey and GRB feature ID"],
      ["D","SDMX dataset key and pollutant code"]
    ],correct:["A"],
    explanation:"GTFS/GTFS-Realtime commonly uses feed-scoped identifiers such as trip_id, route_id and stop_id. Their scope is the publisher/feed context; they are not Belgian national IDs.",
    sourceId:"transportdata",why:"A technically valid key still has a namespace and scope."
  },
  s15:{
    prompt:"You want to compare KBO activity classifications with an NBB.Stat aggregate dataset. What is the essential check before using NACE-BEL as an alignment dimension?",
    options:[
      ["A","Verify the chosen NBB.Stat dataset actually exposes NACE-BEL and that the classification version, period and grain are compatible"],
      ["B","Assume every NBB.Stat dataset uses the current KBO activity code"],
      ["C","Join individual companies to aggregate observations one-to-one"],
      ["D","Convert NACE-BEL to a postcode before comparing"]
    ],correct:["A"],
    explanation:"NACE-BEL is dataset-specific in NBB.Stat. The annual-account aggregate statistics page, for example, documents NACE-BEL 2008 for financial years 2009–2018. Classification alignment is not an entity-level join.",
    sourceId:"nbb-stat",why:"Shared code names do not guarantee shared version, period or grain."
  },
  s18:{
    prompt:"How should you model the relationship between transportdata.be operator feeds and Infrabel infrastructure/performance datasets?",
    options:[
      ["A","As complementary transport sources; only create a direct record mapping when a specific identifier crosswalk is documented"],
      ["B","GTFS trip_id is always identical to an Infrabel track_id"],
      ["C","Every transportdata record has an Infrabel operational-point ID"],
      ["D","The two portals contain the same underlying schema"]
    ],correct:["A"],
    explanation:"transportdata.be catalogues provider datasets/services, while Infrabel maintains infrastructure/performance datasets with its own identifiers. There is no generic direct GTFS-to-Infrabel identifier bridge asserted here.",
    sourceId:"infrabel",why:"Contextual complementarity is not the same thing as joinability."
  },
  s21:{
    prompt:"Which statements correctly describe Basisregisters and GRB? Select every correct statement.",
    options:[
      ["A","Basisregisters exposes persistent identifiers and explicit links among certain registry objects"],
      ["B","Every GRB feature ID is automatically the same identifier as the corresponding Basisregisters object"],
      ["C","GRB collections use their own feature/object model, so a cross-system identity mapping must be demonstrated rather than assumed"],
      ["D","Spatial overlap by itself proves legal or registry identity"]
    ],correct:["A","C"],
    explanation:"Basisregisters and GRB are related Flemish data ecosystems but distinct models. Explicit registry links are strong evidence inside Basisregisters; GRB feature identity must not be silently equated to register identity.",
    sourceId:"basisregisters",why:"The advanced mistake is confusing spatial coincidence with semantic identity."
  }
};

export const QUIZ_EXTRA = [
  {
    id:"fx01",kind:"single",category:"Reuse",difficulty:3,
    prompt:"FPS Economy offers multiple CBE/KBO reuse routes. Which statement is accurate?",
    options:[
      ["A","Public Search itself is the approved bulk-reuse interface"],
      ["B","Open Data is a free limited active-data CSV product; Public Search web services are paid per request package; a broader active/discontinued reuse file is a separate licensed product"],
      ["C","Every reuse route has identical data breadth and pricing"],
      ["D","The complete reuse file contains only active entities"]
    ],correct:["B"],sourceId:"kbo-open",
    explanation:"FPS Economy explicitly distinguishes Open Data, Public Search web services and the complete reuse file, with different scope, pricing and access mechanics.",
    why:"Choosing a source means choosing the correct publication product, not just the authority."
  },
  {
    id:"fx02",kind:"single",category:"Geography",difficulty:3,
    prompt:"Why is a statistical-sector code alone insufficient for a robust long-term municipality join?",
    options:[
      ["A","Since 2019 the municipality code can no longer simply be derived from the statistical-sector code, and sector/boundary vintages change"],
      ["B","Statistical sectors never have codes"],
      ["C","NIS codes are GTFS identifiers"],
      ["D","All Belgian boundaries are immutable"]
    ],correct:["A"],sourceId:"statbel",
    explanation:"Statbel explicitly notes the post-2019 coding change and publishes versioned statistical-sector boundary files. Preserve code tables and geography vintage.",
    why:"A code can be canonical within a version without being timeless."
  },
  {
    id:"fx03",kind:"single",category:"Geography",difficulty:3,
    prompt:"For Flemish agricultural-use parcels, what does '2026 parcel data' fail to tell you by itself?",
    options:[
      ["A","Whether you are using an early provisional snapshot, an October update or the final publication in the following March"],
      ["B","Whether Belgium uses the euro"],
      ["C","Whether GTFS has trip IDs"],
      ["D","Whether NBB publishes annual accounts"]
    ],correct:["A"],sourceId:"landbouw-percelen",
    explanation:"The agricultural authority publishes multiple snapshots per campaign; the first two can still change, while the later publication is final.",
    why:"Snapshot status is part of provenance."
  },
  {
    id:"fx04",kind:"single",category:"Pipelines",difficulty:3,
    prompt:"An engineer says 'I'll just use the Elia load dataset'. What is the strongest response?",
    options:[
      ["A","Specify the exact Elia dataset/variant, resolution and quality notice; the publisher currently warns about a potential issue in the 'Load on the Elia grid' dataset and recommends Total load"],
      ["B","All Elia load datasets are semantically identical"],
      ["C","Dataset identifier is irrelevant if timestamps match"],
      ["D","Convert the values to NIS codes first"]
    ],correct:["A"],sourceId:"elia",
    explanation:"Elia publishes multiple load datasets and quality notices. Dataset identity and resolution belong in the contract, not just column names.",
    why:"Operational data sources can carry live publisher warnings."
  },
  {
    id:"fx05",kind:"multi",category:"Semantics",difficulty:3,
    prompt:"Which distinctions are required when using IRCEL air-quality open data? Select every correct statement.",
    options:[
      ["A","Station observations and modelled concentration surfaces are different data grains"],
      ["B","A station measurement is automatically equal to population exposure"],
      ["C","Temporal aggregation matters when comparing daily, hourly or annual products"],
      ["D","The publisher exposes open-data endpoints under CC BY 4.0"]
    ],correct:["A","C","D"],sourceId:"ircel",
    explanation:"IRCEL exposes station-style endpoints and model products at different temporal/spatial resolutions under CC BY 4.0. Exposure is a separate concept.",
    why:"Same topic does not mean same observational unit."
  },
  {
    id:"fx06",kind:"single",category:"Sources",difficulty:3,
    prompt:"What is the best interpretation of a direct edge in the Data Desk graph after the fact-check audit?",
    options:[
      ["A","Its type determines what it means: direct identifier, classification alignment, spatial context, aggregation or contextual analysis are not equivalent"],
      ["B","Every edge means records can be joined one-to-one"],
      ["C","Every edge guarantees legal permission for reuse"],
      ["D","Every edge implies identical data grain"]
    ],correct:["A"],
    explanation:"The graph is now a typed relationship graph. Only specific edge types are identity-preserving record-level links; others are contextual or analytical.",
    why:"A graph should encode relationship semantics, not flatten them."
  }
];

// Additional portal-level corrections discovered during the 2026-09-30 audit.
SOURCE_OVERRIDES.geopunt = {
  summary:"Geopunt is a Flemish geospatial discovery/viewing ecosystem whose catalogue metadata describes datasets and services; the catalogue is transitioning toward the central Datavindplaats API.",
  note:"Do not infer one uniform schema, licence or access mode from the portal. Individual metadata records identify owner, content, geographic extent, distributions/services and use restrictions; many—but not all—resources expose direct downloads or OGC services.",
  evidence:[
    ["Geopunt catalogue transition / Datavindplaats","https://www.geopunt.be/download"],
    ["Geopunt metadata guidance","https://www.geopunt.be/voor-experts/metadata"]
  ],
  verifiedNote:"Treat Geopunt as discovery/context first; apply the identifiers, licence and service contract of the selected dataset."
};

SOURCE_OVERRIDES.brussels = {
  name:"Datastore Brussels",
  org:"Brussels-Capital Region / Paradigm",
  url:"https://datastore.brussels/",
  access:["Catalogue","Download","Geospatial service","API / web service"],
  formats:["Dataset-specific","Web services","INSPIRE services","Downloads"],
  summary:"The Brussels-Capital Region's open-data portal, listing and documenting datasets and services produced by Brussels public authorities and participating organisations.",
  note:"This replaces the earlier incorrect link to opendata.brussels.be, which is the City of Brussels portal rather than the regional portal. Datastore resources have dataset-specific access methods and conditions; UrbIS is a separate regional reference-geodata family available through the ecosystem.",
  evidence:[
    ["Brussels-Capital Region — Datastore service","https://be.brussels/en/about-region/datastore"],
    ["Datastore Brussels","https://datastore.brussels/"],
    ["Brussels-Capital Region — UrbIS data","https://be.brussels/en/about-region/urbis-data"]
  ],
  verifiedNote:"Regional scope is now correctly attributed to Brussels-Capital Region / Paradigm; the former City of Brussels portal attribution was wrong."
};

GUIDANCE_OVERRIDES.brussels = {
  keys:["Datastore resource ID","Dataset/service-specific identifiers","Geometry / CRS where applicable"],
  joins:["Use the resource's own schema/identifier contract; UrbIS and INSPIRE resources can expose explicit geospatial services."],
  caution:"Datastore is a multi-publisher catalogue/platform. There is no universal record-level Brussels join key across its resources."
};
