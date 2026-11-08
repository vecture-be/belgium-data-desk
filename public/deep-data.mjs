export const EXTRA_SOURCES=[
  {
    "id": "kbo-open",
    "name": "CBE / KBO Open Data",
    "org": "FPS Economy",
    "url": "https://economie.fgov.be/en/themes/enterprises/crossroads-bank-enterprises/services-everyone/public-data-available-reuse/cbe-open-data",
    "region": "Belgium",
    "access": [
      "Download"
    ],
    "topics": [
      "Companies",
      "Economy",
      "Addresses"
    ],
    "formats": [
      "CSV",
      "SFTP"
    ],
    "friction": "Medium",
    "summary": "Reusable daily CSV extracts of active enterprises and establishment units, distinct from Public Search.",
    "use": [
      "Build a local enterprise dimension",
      "Track daily company-register changes",
      "Join enterprise and establishment data at scale"
    ],
    "note": "Registration and terms apply; use this for reuse rather than scraping Public Search."
  },
  {
    "id": "nbb-stat",
    "name": "NBB.Stat",
    "org": "National Bank of Belgium",
    "url": "https://www.nbb.be/en/statistics/topics/general/online-statistical-database",
    "region": "Belgium",
    "access": [
      "API / web service",
      "Download"
    ],
    "topics": [
      "Economy",
      "Finance",
      "Companies"
    ],
    "formats": [
      "SDMX",
      "CSV",
      "JSON",
      "XML",
      "XLSX"
    ],
    "friction": "Low",
    "summary": "Metadata-rich official statistics with downloadable tables and structured developer API queries.",
    "use": [
      "Automate macroeconomic series",
      "Pull dimensional statistics with metadata",
      "Connect sector context to NACE-BEL"
    ],
    "note": "API queries are structured around datasets and dimensions; retain metadata with extracts."
  },
  {
    "id": "fsma",
    "name": "FSMA Data Portal",
    "org": "Financial Services and Markets Authority",
    "url": "https://www.fsma.be/en/data-portal",
    "region": "Belgium",
    "access": [
      "Lookup",
      "Catalogue"
    ],
    "topics": [
      "Finance",
      "Companies",
      "Regulation"
    ],
    "formats": [
      "Web records",
      "Documents"
    ],
    "friction": "Low",
    "summary": "Official regulatory lists for authorisations, registrations, listed companies, issues and managers' transactions.",
    "use": [
      "Check regulated status",
      "Inspect listed-company records",
      "Cross-check a financial actor after KBO"
    ],
    "note": "This is a regulatory register, not a general company database."
  },
  {
    "id": "infrabel",
    "name": "Infrabel Open Data",
    "org": "Infrabel",
    "url": "https://opendata.infrabel.be/",
    "region": "Belgium",
    "access": [
      "API / web service",
      "Download"
    ],
    "topics": [
      "Mobility",
      "Infrastructure",
      "Geography"
    ],
    "formats": [
      "JSON",
      "CSV",
      "API",
      "Geo data"
    ],
    "friction": "Low",
    "summary": "Rail infrastructure and performance data, including punctuality and network datasets with APIs.",
    "use": [
      "Analyse punctuality",
      "Explore railway infrastructure",
      "Combine rail performance with timetable feeds"
    ],
    "note": "Read metric definitions carefully; railway performance measures can be domain-specific."
  },
  {
    "id": "elia",
    "name": "Elia Open Data",
    "org": "Elia",
    "url": "https://opendata.elia.be/",
    "region": "Belgium",
    "access": [
      "API / web service",
      "Download"
    ],
    "topics": [
      "Energy",
      "Infrastructure"
    ],
    "formats": [
      "JSON",
      "CSV",
      "API"
    ],
    "friction": "Low",
    "summary": "Belgian electricity-system observations and forecasts, including load and generation by fuel type.",
    "use": [
      "Track measured and forecast load",
      "Analyse generation mix",
      "Build time-series energy dashboards"
    ],
    "note": "Design production clients for retries and caching; some datasets are high-volume."
  },
  {
    "id": "ircel",
    "name": "IRCEL / CELINE Open Data",
    "org": "Belgian Interregional Environment Agency",
    "url": "https://www.irceline.be/en/documentation/open-data",
    "region": "Belgium",
    "access": [
      "API / web service",
      "Download"
    ],
    "topics": [
      "Environment",
      "Health",
      "Geography"
    ],
    "formats": [
      "JSON",
      "Geo endpoints"
    ],
    "friction": "Low",
    "summary": "Open official air-quality endpoints for pollutants and monitoring observations.",
    "use": [
      "Build PM/NO2/O3 views",
      "Combine air quality with geography",
      "Reuse monitoring observations programmatically"
    ],
    "note": "Measurements require station, pollutant and temporal context."
  },
  {
    "id": "basisregisters",
    "name": "Basisregisters Vlaanderen API",
    "org": "Digitaal Vlaanderen",
    "url": "https://docs.basisregisters.vlaanderen.be/docs/api-documentation.html",
    "region": "Flanders",
    "access": [
      "API / web service"
    ],
    "topics": [
      "Addresses",
      "Buildings",
      "Parcels",
      "Roads",
      "Geography"
    ],
    "formats": [
      "REST",
      "JSON-LD",
      "OpenAPI"
    ],
    "friction": "Low",
    "summary": "Canonical Flemish APIs for addresses, streets, municipalities, buildings, roads and parcels.",
    "use": [
      "Resolve structured addresses",
      "Traverse registry relationships",
      "Fetch canonical parcel/building identifiers"
    ],
    "note": "Rate limits apply; use download products for bulk workloads."
  },
  {
    "id": "grb",
    "name": "GRB OGC API Features",
    "org": "Digitaal Vlaanderen",
    "url": "https://geo.api.vlaanderen.be/GRB/ogc/features/v1",
    "region": "Flanders",
    "access": [
      "Geospatial service",
      "API / web service"
    ],
    "topics": [
      "Geography",
      "Buildings",
      "Roads",
      "Infrastructure"
    ],
    "formats": [
      "OGC API Features",
      "GeoJSON",
      "OpenAPI"
    ],
    "friction": "Low",
    "summary": "Modern OGC API access to vector objects from Flanders' large-scale reference map.",
    "use": [
      "Query detailed base-map features",
      "Fetch vectors directly",
      "Filter published GRB collections"
    ],
    "note": "GRB is detailed reference geometry; choose the right collection for the question."
  },
  {
    "id": "landbouw-percelen",
    "name": "Flemish Agricultural Parcels",
    "org": "Agentschap Landbouw en Zeevisserij",
    "url": "https://landbouwcijfers.vlaanderen.be/open-geodata-landbouwgebruikspercelen",
    "region": "Flanders",
    "access": [
      "Geospatial service",
      "Download"
    ],
    "topics": [
      "Agriculture",
      "Geography",
      "Land use"
    ],
    "formats": [
      "Geo data",
      "Analysis tables"
    ],
    "friction": "Low",
    "summary": "Open agricultural parcel declaration data with crop and land-use information.",
    "use": [
      "Analyse crop acreage",
      "Study parcel-level land use",
      "Aggregate crop areas by municipality"
    ],
    "note": "Agricultural declaration parcels are not the same concept as cadastral parcels."
  },
  {
    "id":"fluvius","name":"Fluvius Open Data","org":"Fluvius","url":"https://opendata.fluvius.be/","region":"Flanders",
    "access":["API / web service","Download"],"topics":["Energy","Infrastructure","Economy"],"formats":["OpenDataSoft API","CSV","JSON"],"friction":"Low",
    "summary":"Aggregated distribution-grid data on consumption, injection, local production, charging infrastructure and storage.",
    "use":["Analyse energy demand and injection geographically","Track distributed generation and storage adoption","Use publisher schemas and record APIs for reproducible extracts"],
    "note":"Most consumption products are deliberately aggregated for privacy. Coverage of registered devices such as private chargers and batteries reflects systems known to Fluvius, not every installation in Flanders.",
    "evidence":[["Fluvius Open Data","https://opendata.fluvius.be/"],["Local production by municipality","https://opendata.fluvius.be/explore/dataset/1_33-lp-open-data-fluvius/"]],
    "verifiedNote":"Checked at concrete dataset level: preserve aggregation dimensions and distinguish registered-device coverage from complete infrastructure inventories."
  },
  {
    "id":"federal-police","name":"Federal Police Statistics","org":"Federal Police","url":"https://www.police.be/statistiques/","region":"Belgium",
    "access":["Download","Lookup"],"topics":["Safety","Society","Mobility"],"formats":["CSV","XLSX","PDF","Interactive tables"],"friction":"Low",
    "summary":"Official statistics on police-recorded crime, traffic enforcement, force structure and the Safety Monitor, with downloadable tables on key views.",
    "use":["Compare recorded crime across geographies and periods","Export offence counts for municipal analysis","Read methodological notes alongside police statistics"],
    "note":"Recorded criminal facts are administrative police data, not a direct measure of underlying crime prevalence. Registration, reporting and processing delays affect interpretation.",
    "evidence":[["Federal Police statistics portal","https://www.police.be/statistiques/fr"],["Recorded criminal facts table","https://www.police.be/statistiques/fr/criminalite/faits-criminels/tableau"]],
    "verifiedNote":"The crime table supports CSV/XLSX export and multiple geographic levels; attempts and completed offences are both included."
  },
  {
    "id":"elections","name":"FPS Interior Election Results","org":"FPS Interior — Directorate of Elections","url":"https://verkiezingen.fgov.be/node/111614","region":"Belgium",
    "access":["Download"],"topics":["Government","Elections","Society"],"formats":["ZIP","XLSX"],"friction":"Low",
    "summary":"Official fixed-vintage result tables for Belgian European, federal and regional elections, including municipality, canton, constituency, list and candidate views.",
    "use":["Analyse official election results by municipality or canton","Separate list totals from candidate preference votes","Preserve election and electoral-geography vintage in reproducible analysis"],
    "note":"Different result tables have different grains. Municipality, canton, constituency, list and candidate tables must not be combined as if they were interchangeable observations.",
    "evidence":[["9 June 2024 result tables","https://verkiezingen.fgov.be/node/111614"]],
    "verifiedNote":"The 2024 archive publishes a municipality-results ZIP plus election-specific XLSX tables at several electoral grains."
  },
  {
    "id":"opgroeien","name":"Opgroeien Childcare Statistics","org":"Agentschap Opgroeien","url":"https://www.opgroeien.be/kennis/cijfers-en-onderzoek/kinderopvang-babys-en-peuters/cijfers-op-maat","region":"Flanders + Brussels",
    "access":["Download","Lookup"],"topics":["Childcare","Society","Population"],"formats":["XLSX","Interactive dashboards"],"friction":"Low",
    "summary":"Local and regional statistics on licensed childcare supply, use, tariffs and coverage, with downloadable Excel files for key capacity indicators.",
    "use":["Compare childcare capacity across municipalities","Distinguish licensed places from utilisation","Analyse income-tariff and care-type composition"],
    "note":"Definitions and denominators vary by indicator. Opgroeien also documents administrative corrections in 2026 that can move reported capacity without equivalent physical closures.",
    "evidence":[["Childcare figures on demand","https://www.opgroeien.be/kennis/cijfers-en-onderzoek/kinderopvang-babys-en-peuters/cijfers-op-maat"]],
    "verifiedNote":"Key capacity and places-per-100-children indicators are downloadable as Excel and include explicit methodological notes."
  },
  {
    "id":"waterinfo","name":"VMM / Waterinfo Geodata","org":"Vlaamse Milieumaatschappij","url":"https://inspirepub.waterinfo.be/arcgis/rest/services","region":"Flanders",
    "access":["Geospatial service","API / web service"],"topics":["Water","Geography","Environment","Infrastructure"],"formats":["ArcGIS REST","WFS","WMS","OGC Features","GeoJSON"],"friction":"Low",
    "summary":"Operational geospatial services for Flemish hydrography, monitoring locations, flood information and related water-management reference layers.",
    "use":["Query the Flemish watercourse reference network","Locate water-level, discharge and rain-gauge stations","Connect GIS workflows directly to maintained VMM services"],
    "note":"Reference layers, monitoring-station layers and actual measurement time series are separate products. A station feature is not itself an observation.",
    "evidence":[["Waterinfo ArcGIS services","https://inspirepub.waterinfo.be/arcgis/rest/services"],["VHA watercourses","https://inspirepub.waterinfo.be/arcgis/rest/services/VHA_waterlopen/MapServer"],["Monitoring points","https://inspirepub.waterinfo.be/arcgis/rest/services/meetpunten/MapServer"]],
    "verifiedNote":"The VHA service exposes queryable watercourse feature layers; the monitoring-points service exposes six point layers and states a Tuesday refresh."
  },
  {
    "id":"vmm-climate","name":"VMM Klimaatportaal Open Data","org":"Vlaamse Milieumaatschappij","url":"https://klimaat.vmm.be/open-data","region":"Flanders",
    "access":["Download"],"topics":["Climate","Environment","Water"],"formats":["ZIP","Time series"],"friction":"Low",
    "summary":"Downloadable climate-scenario inputs and outputs used by the Flemish climate portal, including high-impact precipitation and evapotranspiration forcing series.",
    "use":["Inspect scenario forcing separately from observations","Reproduce scenario-based water/climate analyses","Compare explicitly versioned scenario horizons"],
    "note":"Scenario forcing files are not observations or deterministic forecasts. Keep horizon, season and scenario assumptions attached to every derived result.",
    "evidence":[["2050 high-impact summer precipitation and ETo","https://klimaat.vmm.be/open-data/2050_hoog-impact-zomer_neerslag-eto.zip/view"],["2100 high-impact summer precipitation and ETo","https://klimaat.vmm.be/open-data/2100_hoog-impact-zomer_neerslag-eto.zip/view"]],
    "verifiedNote":"The reviewed files are detrended precipitation and potential-evapotranspiration time series for the Uccle reference point under high-impact summer scenarios."
  },
  {
    "id":"rmi","name":"RMI / KMI Open Data","org":"Royal Meteorological Institute of Belgium","url":"https://opendata.meteo.be/","region":"Belgium",
    "access":["API / web service","Download"],"topics":["Weather","Climate","Environment"],"formats":["API","JSON","CSV","Geospatial data"],"friction":"Low",
    "summary":"Official meteorological open data and documentation, including automatic weather-station observations and other weather/climate products.",
    "use":["Retrieve station observations","Build weather time series","Combine measurements with station metadata"],
    "note":"Observation variables, units, station identity and quality flags belong with every extract; do not treat station samples as spatially continuous weather fields.",
    "evidence":[["RMI Open Data documentation","https://opendata.meteo.be/documentation/?dataset=aws"]],
    "verifiedNote":"The reviewed AWS product is station-observation data; station/time/variable semantics must be retained."
  },
  {
    "id":"riziv","name":"RIZIV / INAMI Reference Data","org":"RIZIV / INAMI","url":"https://www.riziv.fgov.be/nl/nomenclatuur/referentietabellen","region":"Belgium",
    "access":["Download"],"topics":["Health","Government","Reference data"],"formats":["Reference tables","Downloads"],"friction":"Low",
    "summary":"Official reusable reference tables for Belgian health-insurance nomenclature and related coding systems.",
    "use":["Resolve nomenclature codes","Version health-care reference data","Support reimbursement-data modelling"],
    "note":"Codes and attributes are versioned administrative reference data. Effective dates and table relationships must be preserved when interpreting historical claims or tariffs.",
    "evidence":[["RIZIV reference tables","https://www.riziv.fgov.be/nl/nomenclatuur/referentietabellen"]],
    "verifiedNote":"The catalogue record reviewed is NomenSoft coordinated reference data rather than patient-level health data."
  },
  {
    "id":"finance","name":"FPS Finance Open Patrimony Data","org":"FPS Finance — Patrimonial Documentation","url":"https://financien.belgium.be/nl/experten-partners/open-patrimoniumdata","region":"Belgium",
    "access":["Download","Geospatial service"],"topics":["Parcels","Geography","Property","Government"],"formats":["Geodata","Reference tables","WFS/WMS"],"friction":"Medium",
    "summary":"Open patrimonial reference datasets including cadastral-plan products and identifier/geography mapping tables.",
    "use":["Work with cadastral-plan geometry","Use explicit parcel-to-geography crosswalks","Preserve fiscal/reference vintage in property analysis"],
    "note":"Cadastral plan geometry, fiscal state and ownership/administrative concepts are distinct. Current geometry should not silently be combined with historical fiscal attributes.",
    "evidence":[["Cadastral plan dataset","https://financien.belgium.be/nl/experten-partners/open-patrimoniumdata/datasets/kadastraal-plan"],["Product catalogue","https://financien.belgium.be/nl/productencatalogus"]],
    "verifiedNote":"The reviewed products include current/fiscal cadastral-plan data and an explicit plan-parcel to statistical-sector mapping product."
  },
  {
    "id":"ngi","name":"National Geographic Institute Open Geodata","org":"National Geographic Institute","url":"https://ngi.be/aanbod/digitale-geodata/vectoriele-referentiegegevens/","region":"Belgium",
    "access":["Download","Geospatial service"],"topics":["Geography","Boundaries","Imagery","Government"],"formats":["GeoPackage","ESRI Shapefile","WFS","Metadata"],"friction":"Low",
    "summary":"National reference geography and imagery-index products, including administrative/territorial divisions and aerial-photo metadata.",
    "use":["Download national administrative reference layers","Index historical aerial photography","Use authoritative geographic metadata"],
    "note":"A map/reference feature is not automatically the legal authentic-source object it represents. Preserve product release and thematic identifier semantics.",
    "evidence":[["NGI vector reference data","https://ngi.be/aanbod/digitale-geodata/vectoriele-referentiegegevens/"],["geo.be metadata search","https://publish.geo.be/geonetwork/srv/search?type=service-download"]],
    "verifiedNote":"Territorial Divisions is distributed as vector reference data; aerial-photo services index imagery metadata rather than image pixels."
  },
  {
    "id":"dov","name":"Databank Ondergrond Vlaanderen","org":"Vlaamse overheid","url":"https://dov.vlaanderen.be/page/dov-services","region":"Flanders",
    "access":["Geospatial service","API / web service","Download"],"topics":["Groundwater","Geology","Environment","Geography"],"formats":["OGC API Features","WFS","GIS downloads"],"friction":"Low",
    "summary":"Flemish subsurface and groundwater data services, including monitoring-location metadata and versioned geological/hydrogeological models.",
    "use":["Locate groundwater monitoring filters","Query subsurface reference layers","Download model outputs with explicit model versions"],
    "note":"Monitoring-location metadata is not the measurement series, and model outputs are interpretations rather than direct observations.",
    "evidence":[["DOV services","https://dov.vlaanderen.be/page/dov-services"],["H3Dv2 downloads","https://www.dov.vlaanderen.be/page/h3dv2-downloadpagina"]],
    "verifiedNote":"The reviewed groundwater location layer exposes station/filter metadata; H3Dv2 is a versioned model product."
  },
  {
    "id":"onem","name":"RVA / ONEM Statistics","org":"RVA / ONEM","url":"https://www.onem.be/statistiques/chiffres-mensuels","region":"Belgium",
    "access":["Download"],"topics":["Employment","Social security","Economy"],"formats":["XLS","Reports"],"friction":"Low",
    "summary":"Official monthly unemployment and benefit statistics with downloadable geographic/status tables.",
    "use":["Analyse benefit statistics by municipality","Compare statuses over time","Separate payment statistics from registered-jobseeker concepts"],
    "note":"Physical units, payments and regionally registered jobseekers are different populations/measures. Preserve status definition and reporting period.",
    "evidence":[["Monthly statistics","https://www.onem.be/statistiques/chiffres-mensuels"],["Geographic status tables","https://www.onem.be/statistiques/chiffres-mensuels/chiffres-par-statut-commune-arrondissement-et-province"]],
    "verifiedNote":"The reviewed product supplies monthly status/geography tables down to municipality level."
  },
  {
    "id":"bipt","name":"BIPT / IBPT Open Data","org":"Belgian Institute for Postal Services and Telecommunications","url":"https://www.bipt.be/consumenten/publicatie/open-data","region":"Belgium",
    "access":["Download"],"topics":["Telecom","Infrastructure","Geography"],"formats":["Open-data downloads","Tables"],"friction":"Low",
    "summary":"Telecommunications open-data publications and historical coverage datasets from the Belgian telecom regulator.",
    "use":["Analyse historical telecom coverage","Retain technology and administrative vintage","Use regulator-published market/infrastructure data"],
    "note":"Some open-data files are historical snapshots. Administrative geography and mobile-network technology can make older coverage products unsuitable for current-state claims.",
    "evidence":[["BIPT Open Data","https://www.bipt.be/consumenten/publicatie/open-data"]],
    "verifiedNote":"The curated mobile-coverage record is explicitly historical (2016) and should not be presented as current coverage."
  },
  {
    "id":"omgeving","name":"Departement Omgeving Open Data","org":"Departement Omgeving — Vlaamse overheid","url":"https://data.omgeving.vlaanderen.be/","region":"Flanders",
    "access":["Download","API / web service","Geospatial service"],"topics":["Planning","Land use","Environment","Geography"],"formats":["RDF","SPARQL","GIS raster","Geodata"],"friction":"Low",
    "summary":"Flemish environmental and spatial-planning data, including linked DSI planning information and versioned land-use/space-take raster products.",
    "use":["Query planning data as linked entities","Download land-use rasters","Keep legal/planning concepts separate from observed land use"],
    "note":"The products span different data models: RDF planning graphs, categorical land-use rasters and derived binary indicators should not be flattened into one generic spatial dataset.",
    "evidence":[["DSI linked data","https://data.dsi.omgeving.vlaanderen.be/"],["Land-use indicators","https://indicatoren.omgeving.vlaanderen.be/indicatoren/landgebruik"]],
    "verifiedNote":"The reviewed DSI product is a linked-data graph; land-use and space-take products are separate raster concepts with explicit vintages."
  },
  {"id":"brussels-mobility","name":"Brussels Mobility Open Data","org":"Brussels Mobility","url":"https://data.mobility.brussels/","region":"Brussels","access":["API / web service","Download","Geospatial service"],"topics":["Mobility","Cycling","Traffic","Geography"],"formats":["JSON","CSV","WFS","WMS","GeoPackage"],"friction":"Low","summary":"Operational Brussels mobility APIs and geodata including bicycle counters, traffic detectors, incidents and road infrastructure.","use":["Analyse cycling time series","Track traffic counts and congestion signals","Map Brussels mobility infrastructure"],"note":"Sensor accuracy, interval semantics and historical availability are dataset-specific."},
  {"id":"onderwijs","name":"Onderwijs & Vorming APIs","org":"Flemish Department of Education and Training","url":"https://onderwijs-api-portaal.vlaanderen.be/documentatie/instellingsgegevens","region":"Flanders","access":["API / web service","Download"],"topics":["Education","Addresses","Government"],"formats":["REST","JSON","CSV"],"friction":"Low","summary":"Public APIs for recognised education institutions, institution locations, code lists and organised education offerings.","use":["Build a canonical school/institution directory","Locate campuses and teaching locations","Inspect recognised and actually organised education offerings"],"note":"Institution, establishment and teaching-location identifiers have different scopes; preserve API version and identifier type."},
  {"id":"awv","name":"Agentschap Wegen en Verkeer Open Data","org":"Agentschap Wegen en Verkeer","url":"https://www.vlaanderen.be/datavindplaats/catalogus/wfs-agentschap-wegen-en-verkeer","region":"Flanders","access":["Download","Geospatial service"],"topics":["Mobility","Roads","Cycling","Infrastructure"],"formats":["CSV","WFS","WMS"],"friction":"Low","summary":"Road-infrastructure geodata and traffic/cycling datasets published by the Flemish road authority.","use":["Analyse automatic bicycle counts","Map road attributes and speed-regime segments","Reuse road-management geodata"],"note":"Some datasets are historical archives even when their metadata pages remain live; read lifecycle status before using as current truth."},
  {"id":"ovam","name":"OVAM Open Environmental Data","org":"Openbare Vlaamse Afvalstoffenmaatschappij","url":"https://www.vlaanderen.be/datavindplaats/catalogus/stortplaatsen-in-vlaanderen","region":"Flanders","access":["Download","Geospatial service"],"topics":["Environment","Waste","Soil","Geography"],"formats":["GeoPackage","WMS"],"friction":"Low","summary":"Public environmental geodata on waste, soil and known landfill locations in Flanders.","use":["Map known landfill sites","Overlay environmental-risk locations with other geodata","Reuse public waste/soil reference layers"],"note":"Inventory layers describe administratively known locations and should not be interpreted as exhaustive contamination measurements."}
];
export const GUIDANCE={
  "statbel": {
    "keys": [
      "NIS code",
      "Statistical sector",
      "NACE-BEL"
    ],
    "joins": [
      "NIS codes connect statistics to regional geography.",
      "Statistical-sector codes support sub-municipal analysis."
    ],
    "caution": "Keep period and boundary vintage together; names alone are weak join keys."
  },
  "datagov": {
    "keys": [
      "Dataset URI",
      "Publisher"
    ],
    "joins": [
      "Use it to discover the publisher, then switch to that publisher's technical endpoint."
    ],
    "caution": "Catalogue freshness and dataset freshness are different things."
  },
  "kbo": {
    "keys": [
      "Enterprise number",
      "Establishment-unit number",
      "NACE-BEL"
    ],
    "joins": [
      "Enterprise number pivots to NBB filings and regulated-status checks.",
      "NACE-BEL bridges to sector statistics."
    ],
    "caution": "Public Search is targeted consultation; systematic reuse is not the intended access path."
  },
  "nbb": {
    "keys": [
      "Enterprise number",
      "Deposit reference",
      "XBRL taxonomy"
    ],
    "joins": [
      "Enterprise number is the clean bridge from KBO to filed annual accounts."
    ],
    "caution": "Professional web services require registration/subscription; older filings are not available in every structured format."
  },
  "transportdata": {
    "keys": [
      "GTFS stop_id",
      "trip_id",
      "route_id"
    ],
    "joins": [
      "Static GTFS identifiers connect to realtime feeds within a provider.",
      "Coordinates bridge feeds to geodata."
    ],
    "caution": "It is a catalogue of providers; authentication, limits and freshness vary per feed."
  },
  "geopunt": {
    "keys": [
      "NIS code",
      "Coordinates",
      "Layer identifier"
    ],
    "joins": [
      "Combine canonical base objects with thematic layers.",
      "NIS/coordinates connect maps to statistics."
    ],
    "caution": "Licence, owner and update date are layer-specific."
  },
  "datavlaanderen": {
    "keys": [
      "URI identifiers",
      "OSLO concepts"
    ],
    "joins": [
      "Provides semantics behind many Flemish registry identifiers."
    ],
    "caution": "Best for integration architecture and semantics, not as a general dataset browser."
  },
  "wallonia": {
    "keys": [
      "Administrative codes",
      "Coordinates",
      "Service identifier"
    ],
    "joins": [
      "Administrative geography and coordinates connect to national statistics."
    ],
    "caution": "A map, dataset and reusable service are different access products."
  },
  "brussels": {
    "keys": [
      "Dataset identifier",
      "Coordinates",
      "Administrative geography"
    ],
    "joins": [
      "Mobility and urban data complement transportdata.be and federal statistics."
    ],
    "caution": "Check each record's update metadata before comparing series."
  },
  "geobe": {
    "keys": [
      "INSPIRE identifier",
      "Service URL",
      "Coordinates"
    ],
    "joins": [
      "Federal discovery layer across regional and thematic geodata."
    ],
    "caution": "Usually a discovery layer; service behaviour belongs to the publisher."
  },
  "kbo-open": {
    "keys": [
      "Enterprise number",
      "Establishment-unit number",
      "NACE-BEL"
    ],
    "joins": [
      "Enterprise number joins directly to NBB annual accounts.",
      "Establishment addresses can be normalised into regional address systems."
    ],
    "caution": "Registration/terms and privacy restrictions apply; this is distinct from Public Search."
  },
  "nbb-stat": {
    "keys": [
      "SDMX dataset key",
      "Dimension codes",
      "NACE-BEL"
    ],
    "joins": [
      "NACE-BEL links aggregate sector statistics to activity classifications."
    ],
    "caution": "Preserve structure metadata so dimension codes remain interpretable."
  },
  "fsma": {
    "keys": [
      "Enterprise identity",
      "Authorisation record"
    ],
    "joins": [
      "Use after KBO when the activity is financially regulated."
    ],
    "caution": "Absence from one category does not imply absence from every regulatory regime."
  },
  "infrabel": {
    "keys": [
      "Dataset identifier",
      "Station/line reference",
      "Datetime"
    ],
    "joins": [
      "Combine operator timetable feeds with infrastructure/performance context."
    ],
    "caution": "Neutralised vs non-neutralised punctuality definitions can change interpretation."
  },
  "elia": {
    "keys": [
      "Datetime",
      "Dataset identifier",
      "ENTSO-E fuel type"
    ],
    "joins": [
      "Time is the main bridge to environmental and economic series."
    ],
    "caution": "Correlation with weather or air quality is not causation."
  },
  "ircel": {
    "keys": [
      "Station code",
      "Datetime",
      "Pollutant code"
    ],
    "joins": [
      "Station coordinates connect naturally to regional geodata."
    ],
    "caution": "Station measurements are not identical to population exposure."
  },
  "basisregisters": {
    "keys": [
      "Address objectId",
      "Street objectId",
      "NIS code",
      "CaPaKey"
    ],
    "joins": [
      "NIS bridges to statistics; object IDs connect registry objects; CaPaKey identifies cadastral parcels."
    ],
    "caution": "Do not reconstruct canonical keys from address text if a registry identifier exists."
  },
  "grb": {
    "keys": [
      "GRB object ID",
      "Collection ID",
      "Geometry"
    ],
    "joins": [
      "Basisregisters supplies semantic identity; GRB supplies detailed geometry."
    ],
    "caution": "Object identifiers are collection/model-specific, not universal Belgian feature IDs."
  },
  "landbouw-percelen": {
    "keys": [
      "Geometry",
      "Municipality",
      "Crop attributes"
    ],
    "joins": [
      "Overlay with GRB/Geopunt and aggregate by municipality to compare with official statistics."
    ],
    "caution": "Declared agricultural parcels and cadastral parcels are different real-world concepts."
  },
  "brussels-mobility":{"keys":["featureID","Detector / traverse ID","Timestamp"],"joins":["Device identifiers connect observations to counter locations; normalize timestamp semantics before time-series joins."],"caution":"Sensor accuracy and live/history time semantics differ by endpoint."},
  "onderwijs":{"keys":["Institution identifier","Vestigingsnummer","Lesplaatscode"],"joins":["Institution IDs connect registry entities to locations and organised education offerings."],"caution":"Vestigingsnummer is only unique within an institution; theoretical offering is not the same as actually organised offering."},
  "awv":{"keys":["Site ID","Direction ID","Road segment geometry"],"joins":["Bike-count site/direction references connect monthly observations to counter context; road geodata uses separate feature identities."],"caution":"A live service URL does not mean every layer is current; some datasets are explicitly historical archives."},
  "ovam":{"keys":["Inventory feature","Geometry","Environmental classification"],"joins":["Spatial overlay connects environmental inventory locations to parcels/addresses; geometry is contextual, not a shared identity key."],"caution":"Inventory presence/absence is not equivalent to measured contamination presence/absence."}
};
export const WORKFLOWS=[
  {
    "id": "company",
    "n": "01",
    "title": "I have a company number",
    "question": "Verify one company without confusing lookup with bulk reuse.",
    "keys": [
      "Enterprise number",
      "NACE-BEL"
    ],
    "steps": [
      [
        "kbo",
        "Verify identity",
        "Status, names, activities and establishments."
      ],
      [
        "nbb",
        "Inspect filings",
        "Use the same enterprise number for annual accounts."
      ],
      [
        "fsma",
        "Check regulation",
        "If relevant, verify financial authorisation/registration."
      ],
      [
        "nbb-stat",
        "Add context",
        "Move from the firm to aggregate sector statistics."
      ]
    ],
    "bulk": [
      "kbo-open",
      "nbb"
    ]
  },
  {
    "id": "address",
    "n": "02",
    "title": "I have an address or parcel",
    "question": "Resolve canonical objects first, then add geometry and context.",
    "keys": [
      "NIS code",
      "Address objectId",
      "CaPaKey"
    ],
    "steps": [
      [
        "basisregisters",
        "Resolve object",
        "Get canonical address, street, municipality, building or parcel IDs."
      ],
      [
        "grb",
        "Fetch geometry",
        "Use OGC API Features for detailed base-map vectors."
      ],
      [
        "geopunt",
        "Add themes",
        "Planning, environment and infrastructure layers."
      ],
      [
        "statbel",
        "Add statistics",
        "Use NIS or spatial aggregation for official statistics."
      ]
    ],
    "bulk": [
      "basisregisters",
      "grb",
      "geopunt"
    ]
  },
  {
    "id": "population",
    "n": "03",
    "title": "I need population by place",
    "question": "Keep the statistical code and the boundary vintage together.",
    "keys": [
      "NIS code",
      "Statistical sector"
    ],
    "steps": [
      [
        "statbel",
        "Choose statistic",
        "Start from official population files at the right level."
      ],
      [
        "statbel",
        "Keep the code",
        "Preserve NIS/statistical-sector identifiers."
      ],
      [
        "geobe",
        "Find geography",
        "Locate federal/national geographic resources."
      ],
      [
        "geopunt",
        "Enrich regionally",
        "Use the corresponding regional portal for themes."
      ]
    ],
    "bulk": [
      "statbel",
      "geobe",
      "geopunt",
      "wallonia",
      "brussels"
    ]
  },
  {
    "id": "mobility",
    "n": "04",
    "title": "I need mobility data",
    "question": "Separate schedules, realtime feeds, infrastructure and performance.",
    "keys": [
      "GTFS stop_id",
      "trip_id",
      "route_id"
    ],
    "steps": [
      [
        "transportdata",
        "Discover feeds",
        "Find GTFS, GTFS-RT, NeTEx, GBFS or DATEX II."
      ],
      [
        "transportdata",
        "Keep feed IDs",
        "Preserve operator/feed-scoped identifiers."
      ],
      [
        "infrabel",
        "Add rail context",
        "Infrastructure and punctuality/performance."
      ],
      [
        "geobe",
        "Map it",
        "Use coordinates and official geo services."
      ]
    ],
    "bulk": [
      "transportdata",
      "infrabel"
    ]
  },
  {
    "id": "energy",
    "n": "05",
    "title": "I need energy + environment",
    "question": "Align high-frequency series by time before drawing conclusions.",
    "keys": [
      "Datetime",
      "Station code",
      "Fuel type"
    ],
    "steps": [
      [
        "elia",
        "Get grid series",
        "Load, forecasts or generation at the needed resolution."
      ],
      [
        "ircel",
        "Add air quality",
        "Pollutant observations and station context."
      ],
      [
        "statbel",
        "Add denominators",
        "Population/economic context where needed."
      ],
      [
        "geobe",
        "Attach geography",
        "Map stations or administrative aggregation."
      ]
    ],
    "bulk": [
      "elia",
      "ircel",
      "statbel"
    ]
  },
  {
    "id": "agri",
    "n": "06",
    "title": "I need agricultural land data",
    "question": "Do not confuse declared agricultural use with cadastral identity.",
    "keys": [
      "Geometry",
      "Municipality",
      "NIS code"
    ],
    "steps": [
      [
        "landbouw-percelen",
        "Start from declarations",
        "Crop and land-use information."
      ],
      [
        "grb",
        "Overlay base map",
        "Detailed reference geometry."
      ],
      [
        "geopunt",
        "Add themes",
        "Soil, environment, planning or infrastructure."
      ],
      [
        "statbel",
        "Aggregate",
        "Compare with broader official statistics."
      ]
    ],
    "bulk": [
      "landbouw-percelen",
      "grb",
      "geopunt",
      "statbel"
    ]
  },
  {
    "id": "discover",
    "n": "07",
    "title": "I only know the question",
    "question": "Find the owner first, then switch to the authoritative endpoint.",
    "keys": [
      "Dataset URI",
      "Publisher",
      "Service URL"
    ],
    "steps": [
      [
        "datagov",
        "Search nationally",
        "Discover likely publishers."
      ],
      [
        "geobe",
        "Search spatially",
        "Use the geo catalogue when location matters."
      ],
      [
        "datavlaanderen",
        "Check semantics",
        "Use canonical models and identifiers in Flanders."
      ],
      [
        "brussels",
        "Go regional",
        "Use regional portals for local coverage."
      ]
    ],
    "bulk": [
      "datagov",
      "geobe",
      "datavlaanderen",
      "brussels",
      "wallonia"
    ]
  }
];
export const IDENTIFIERS=[
  [
    "Enterprise number",
    "0xxx.xxx.xxx",
    "Companies",
    "KBO ↔ NBB filings ↔ regulatory records",
    "Prefer the canonical number as the company join key."
  ],
  [
    "Establishment-unit number",
    "2.xxx.xxx.xxx",
    "Establishments",
    "Enterprise ↔ physical business unit",
    "Useful when one enterprise has several locations."
  ],
  [
    "NACE-BEL",
    "activity code",
    "Economic activity",
    "KBO ↔ Statbel/NBB sector context",
    "Version matters; do not silently mix classifications."
  ],
  [
    "NIS code",
    "municipality code",
    "Administrative geography",
    "Statistics ↔ regional geodata",
    "Much stronger than municipality-name joins."
  ],
  [
    "Statistical sector",
    "sector code",
    "Sub-municipal geography",
    "Statbel table ↔ statistical-sector geometry",
    "Keep dataset and boundary vintages aligned."
  ],
  [
    "Address objectId",
    "registry ID",
    "Flanders addresses",
    "Address ↔ street ↔ municipality ↔ building",
    "Use registry IDs instead of reconstructing keys from text."
  ],
  [
    "CaPaKey",
    "11001B0001/00S000",
    "Cadastral parcel",
    "Parcel register ↔ cadastral reference",
    "Not the same concept as an agricultural declaration parcel."
  ],
  [
    "GRB object ID",
    "collection-scoped",
    "Flanders base map",
    "Detailed geometry ↔ GRB collection",
    "Interpret inside the relevant GRB object model."
  ],
  [
    "EPSG:31370",
    "Belgian Lambert 72",
    "Coordinates",
    "Legacy Belgian projected geodata",
    "Verify CRS before overlaying."
  ],
  [
    "EPSG:3812",
    "Belgian Lambert 2008",
    "Coordinates",
    "Modern Belgian projected geodata",
    "Do not treat projected coordinates as lon/lat."
  ],
  [
    "GTFS IDs",
    "stop_id / trip_id / route_id",
    "Public transport",
    "Static schedule ↔ realtime feed",
    "Generally provider/feed scoped."
  ],
  [
    "SDMX keys",
    "dataset + dimensions",
    "Statistical APIs",
    "NBB.Stat query ↔ observations",
    "Store structure metadata with extracts."
  ],
  [
    "Dataset identifier",
    "portal slug / ID",
    "Open-data portals",
    "Metadata ↔ API ↔ export",
    "Stability depends on the publisher."
  ]
];
export const BRIDGES=[
  [
    "kbo",
    "nbb",
    "Enterprise number",
    "Company identity → filed accounts",
    "Direct"
  ],
  [
    "kbo",
    "fsma",
    "Enterprise identity",
    "Company → regulated status",
    "Conditional"
  ],
  [
    "kbo-open",
    "nbb-stat",
    "NACE-BEL",
    "Company activity → sector context",
    "Analytical"
  ],
  [
    "statbel",
    "geopunt",
    "NIS / coordinates",
    "Statistics → Flemish geography",
    "Spatial"
  ],
  [
    "statbel",
    "wallonia",
    "NIS / coordinates",
    "Statistics → Walloon geography",
    "Spatial"
  ],
  [
    "basisregisters",
    "grb",
    "Object / geometry",
    "Canonical object → detailed geometry",
    "Complementary"
  ],
  [
    "grb",
    "geopunt",
    "Coordinates / overlay",
    "Base map → thematic layers",
    "Spatial"
  ],
  [
    "transportdata",
    "infrabel",
    "Rail / place / time",
    "Timetable → rail performance",
    "Analytical"
  ],
  [
    "elia",
    "ircel",
    "Datetime + geography",
    "Power system → air-quality context",
    "Analytical"
  ],
  [
    "landbouw-percelen",
    "statbel",
    "Municipality / aggregation",
    "Parcel declarations → official aggregates",
    "Aggregate"
  ]
];
