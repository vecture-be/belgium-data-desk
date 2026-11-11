// Offline tests for the DOV subsurface tools (dov.mjs): coordinates, id parsing, XML layers, upstream guards and the two tool answers,
// against recorded-shape fixtures. scripts/live-dov.mjs runs the same questions against the real services.
import assert from "node:assert/strict";
import { columnFromBands, getSubsurfaceRecord, isbt, makeDovClient, operatorName, parseRecordId, sbtClass, subsurfaceAtLocation, summariseLevels, wgs84ToLambert72, xmlLayers } from "../dov.mjs";
import { searchSubsurface } from "../dov-search.mjs";
import { handleMcp } from "../mcp-server.mjs";

// Lambert 72 against the Flemish geolocation service (which returns both systems for an address): centimetre agreement.
assert.deepEqual(wgs84ToLambert72(50.879379482656915,4.7006545962260091),[173358.14,174387.29]);   // Grote Markt 1, Leuven

// Record ids: only kind/permkey (or the DOV URI for it) pass, so nothing a caller sends reaches a URL or a CQL filter unchecked.
assert.deepEqual(parseRecordId("boring/2021-183767"),{kind:"boring",key:"2021-183767"});
assert.deepEqual(parseRecordId("https://www.dov.vlaanderen.be/data/filter/2019-108888.xml"),{kind:"filter",key:"2019-108888"});
for(const bad of ["boring/2021-183767' OR '1'='1","https://evil.example/data/boring/2021-183767","put/2022-104525","boring/../x","",null])assert.equal(parseRecordId(bad),null);

// XML layers: leaves with dotted paths for nesting, entities decoded, repeated leaves joined.
assert.deepEqual(xmlLayers("<x><laag><van>0.00</van><tot>3.40</tot><hoofdnaam><grondsoort>MZ</grondsoort></hoofdnaam><beschrijving>sable &amp; argile</beschrijving></laag><laag><van>3.4</van><tot>4</tot><leeg/></laag></x>"),
  [{van:"0.00",tot:"3.40","hoofdnaam.grondsoort":"MZ",beschrijving:"sable & argile"},{van:"3.4",tot:"4"}]);

// Water levels: duplicates counted once, unreliable readings excluded, yearly means.
const lv=summariseLevels([{datum:"2024-01-10",peilMtaw:10},{datum:"2024-01-10",peilMtaw:10},{datum:"2024-06-10",peilMtaw:"12"},{datum:"2025-01-10",peilMtaw:11,betrouwbaarheid:"SLECHT"},{datum:"2025-02-10",peilMtaw:9,diepteTovReferentiepunt:2.5},{datum:"bad"}]);
assert.equal(lv.measurements,3);assert.equal(lv.excluded_unreliable,1);assert.deepEqual(lv.latest,{date:"2025-02-10",level_m_taw:9,depth_below_reference_m:2.5});
assert.deepEqual(lv.highest,{date:"2024-06-10",level_m_taw:12});assert.deepEqual(lv.yearly_means,[{year:2024,mean_m_taw:11,measurements:2},{year:2025,mean_m_taw:9,measurements:1}]);
assert.equal(summariseLevels([]),null);

// Robertson (2010) SBT index: textbook points (qc 10 MPa, Rf 0.5 % -> sand; qc 0.5 MPa, Rf 5 % -> clay); no fs, no class.
assert.equal(sbtClass(isbt(10,50)).split(":")[0],"sand");assert.equal(sbtClass(isbt(0.5,25)).split(":")[0],"clay");
assert.equal(sbtClass(isbt(0.2,20)).split(":")[0],"organic soil");assert.equal(isbt(10,null),null);assert.equal(sbtClass(null),null);
assert.equal(columnFromBands({g_A_b:3},{prefix:"g_"}),null,"no ground level, no column");

// ---------- fixtures: a fake DOV that answers by layer / path ----------
const fc=rows=>JSON.stringify({type:"FeatureCollection",features:rows.map(properties=>({type:"Feature",geometry:null,properties})),numberMatched:rows.length});
const LAYERS={
  "bodemkaart:bodemtypes":[{Bodemtype:"Zbg",Beknopte_omschrijving_bodemserie:"Droge zandgronden",Textuurklasse:"Zand",Drainageklasse:"droog"}],
  "neo_paleo:tertiair_50k":[{code:"Br",formatie:"Formatie van Brussel",lid:null,beschrijving:"bleekgrijs fijn zand"}],
  "quartair:quartair_200k":[{type:"1",profiel:"Geen Holocene afzettingen"}],
  "gw_beleid:gwlv2_grondwaterlichamen":[{Grondwaterlichaam_code:"BEVLS_A0600_1",Grondwaterlichaam_naam:"Ledo Paniseliaan Brusseliaan zuid",horizonten:"2,3"}],
  "gw_bescherming:beschermingszones":[],
  "dov-pub:Boringen":[
    {boornummer:"B-far",fiche:"https://www.dov.vlaanderen.be/data/boring/1900-000002",diepte_tot_m:170,X_mL72:173558,Y_mL72:174387,formele_stratigrafie:true,lithologische_beschrijving:false},
    {boornummer:"B-near",fiche:"https://www.dov.vlaanderen.be/data/boring/2016-000001",diepte_tot_m:10,datum_aanvang:"2016-01-01",X_mL72:173368,Y_mL72:174387,Z_mTAW:21,formele_stratigrafie:true,lithologische_beschrijving:true}
  ],
  "dov-pub:Sonderingen":[],
  "gw_meetnetten:grondwaterlocaties":[{GW_ID:"1-0311",filternummer:"1",filterfiche:"https://www.dov.vlaanderen.be/data/filter/1978-006372",X_mL72:173400,Y_mL72:174387,onderkant_filter_m:15.5,Aquifer_HCOVv2:"A0620 - Zand van Brussel",meetnet:"meetnet 1",peilmetingen_van:"1978-04-06",peilmetingen_tot:"2026-04-14"}],
  "gw_varia:stand_freatisch":[{Putnummer:"3006-076",Filternummer:1,Filterfiche:"https://www.dov.vlaanderen.be/data/filter/1993-000004",Datum:"2026-11-02",Relatief_percentiel:"<P10",Trend:"gestegen",X:176977,Y:170130}],
  "interpretaties:formele_stratigrafie":[{Interpretatiefiche:"https://www.dov.vlaanderen.be/data/interpretatie/2004-000010",Datum:"2004-09-15",Betrouwbaarheid:"goed"},{Interpretatiefiche:"https://www.dov.vlaanderen.be/data/interpretatie/1993-000011",Datum:"1993-01-01",Betrouwbaarheid:"goed"}],
  "interpretaties:lithologische_beschrijvingen":[{Interpretatiefiche:"https://www.dov.vlaanderen.be/data/interpretatie/1876-000012",Datum:"1876-06-09",Betrouwbaarheid:"goed"}],
  "gw_meetnetten:grondwatermonsters":[
    {monster:"M2021",monster_link:"https://www.dov.vlaanderen.be/data/monster/2021-000001",permkey_monster:"2021-000001",bemonsteringsdatum:"2021-08-13",gekoppeld_aan:"|filter:1978-006372|"},
    {monster:"M2025",monster_link:"https://www.dov.vlaanderen.be/data/monster/2025-000002",permkey_monster:"2025-000002",bemonsteringsdatum:"2025-03-14",gekoppeld_aan:"|filter:1978-006372|"}
  ],
  "gw_meetnetten:grondwaterobservaties":[
    {gekoppeld_aan_link:"https://www.dov.vlaanderen.be/data/monster/2025-000002",parameter:"Nitraat (NO3)",parametergroep:"Anionen",resultaat:"14.384",eenheid:"mg/l",fenomeentijd:"2025-03-14"},
    {gekoppeld_aan_link:"https://www.dov.vlaanderen.be/data/monster/2025-000002",parameter:"Arseen (As)",parametergroep:"Zware metalen",resultaat:"5.000",eenheid:"µg/l",detectieconditie:"<",fenomeentijd:"2025-03-14"},
    {gekoppeld_aan_link:"https://www.dov.vlaanderen.be/data/monster/2021-000001",parameter:"Nitraat (NO3)",parametergroep:"Anionen",resultaat:"16.744",eenheid:"mg/l",fenomeentijd:"2021-08-13"}
  ],
  "gw_vergunningen:huidige_verg":[
    {vergunning:"https://www.dov.vlaanderen.be/data/vergunning/2024-000001",exploitant_naam:"INBEV BELGIUM",exploitant_KBOnr:"0433666709",vergund_jaardebiet:2424000,aquifer_HCOVv2_vergunning:"A0620: Zand van Brussel",vergunde_diepte_m:28,installatie_X_mL72:173800,installatie_Y_mL72:175100,IIOA_nacebelcode:"1105: Vervaardiging van bier"},
    {vergunning:"https://www.dov.vlaanderen.be/data/vergunning/2024-000002",exploitant_naam:"Janssens Jan",exploitant_KBOnr:null,vergund_jaardebiet:5000,aquifer_HCOVv2_vergunning:"A0100: Quartaire Aquifersystemen",installatie_X_mL72:173400,installatie_Y_mL72:174387,IIOA_nacebelcode:"0146: Fokken van varkens"},
    {vergunning:"https://www.dov.vlaanderen.be/data/vergunning/2024-000003",exploitant_naam:"Stad Leuven",exploitant_KBOnr:null,vergund_jaardebiet:3500,aquifer_HCOVv2_vergunning:"A0620: Zand van Brussel",installatie_X_mL72:172583,installatie_Y_mL72:174270,IIOA_nacebelcode:"0000: onbekend"}
  ],
  "bodem:bodemlocaties":[{Naam:"KART_PROF_031W/08",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478",Type:"profielput",Datum:"1964-11-18",X_mL72:173500,Y_mL72:174500,Aantal_observaties:142,Aantal_monsters:6,Bodemstreek:"Kempen"}],
  "bodem:bodemdiepteintervallen":[
    {Nr:2,Naam:"B2h",Diepteintervalfiche:"https://www.dov.vlaanderen.be/data/bodemdiepteinterval/2019-000002",Bovengrens1:22,Ondergrens1:42,Beschrijving:"zwarte humusaanrijkingshorizont",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Nr:1,Naam:"A1",Diepteintervalfiche:"https://www.dov.vlaanderen.be/data/bodemdiepteinterval/2019-000001",Bovengrens1:0,Ondergrens1:22,Beschrijving:"De beschrijving is opgenomen in de observaties",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"}
  ],
  "bodem:bodemclassificaties":[{Classificatietype:"Algemene Belgische classificatie",Bodemtype:"Zbg",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},{Classificatietype:"WRB 2014 classificatie",Bodemtype:"Albic Podzol",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"}],
  "bodem:bodemobservaties":[
    {Aan:"bodemlocatie",Parameter:"Diepte (grond)watertafel t.o.v. maaiveld",Waarde:"90",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemlocatie",Parameter:"Drainage Aardewerk - klasse",Waarde:"Dk4 - goed gedraineerd",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemdiepteinterval",Parentfiche:"https://www.dov.vlaanderen.be/data/bodemdiepteinterval/2019-000001",Parameter:"Kleur volgens Munsell - HUE_getal (kleur1)",Waarde:"10.0",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemdiepteinterval",Parentfiche:"https://www.dov.vlaanderen.be/data/bodemdiepteinterval/2019-000001",Parameter:"Kleur volgens Munsell - HUE_letters (kleur1)",Waarde:"YR",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemdiepteinterval",Parentfiche:"https://www.dov.vlaanderen.be/data/bodemdiepteinterval/2019-000001",Parameter:"Kleur volgens Munsell - VALUE (kleur1)",Waarde:"3.0",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemdiepteinterval",Parentfiche:"https://www.dov.vlaanderen.be/data/bodemdiepteinterval/2019-000001",Parameter:"Kleur volgens Munsell - CHROMA (kleur1)",Waarde:"1.0",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemmonster",Diepte_van:0,Diepte_tot:22,Parameter:"Organische C - percentage",Waarde:"3.2",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemmonster",Diepte_van:25,Diepte_tot:35,Parameter:"pH KCl",Waarde:"3.65",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"},
    {Aan:"bodemmonster",Diepte_van:0,Diepte_tot:22,Parameter:"pH KCl",Waarde:"9.9",Bodemlocatiefiche:"https://www.dov.vlaanderen.be/data/bodemlocatie/2000-999999"}   // another profile at the same point
  ]
};
LAYERS["bodemkaart:bodemtypes"].push({Bodemtype:"Zbg",Textuurklasse:"zand",Drainageklasse:"droog",Profielontwikkelingsgroep:"met duidelijke humus en/of ijzer B horizont"});
// One pixel of each 3D model, as GetFeatureInfo returns it (absent units are null or -9999).
const PIXEL={
  "g3dv3_1:g3dv3_1_multiband":{g_Topografie:26.68,g_A_b:-9999,g_010103Q_GtDi_GtTi_GtOg_b:22.78,g_0310PA_Br_b:4.06,g_031603PA_KoOr_b:-27.42,g_0201NE_Me_b:null,g_0402KR_Ne_Do_Gu_Va_Be_Vg_Es_Ms_b:-133.18,g_10SI_11OR_12CM_t:-133.18},
  "h3dv2_1:h3dv2_1_multiband":{Topografie:26.68,A0152:22.78,A0620:4.06,A0110:null,A1103:-133.18,A1340:-133.18}
};
const XSD_HCOV='<xs:simpleType name="AquiferHCOVv2EnumType"><xs:restriction><xs:enumeration value="A0620"><xs:annotation><xs:documentation>Zand van Brussel</xs:documentation></xs:annotation></xs:enumeration><xs:enumeration value="A1340"><xs:annotation><xs:documentation>Cambro-Siluur Massief van Brabant</xs:documentation></xs:annotation></xs:enumeration></xs:restriction></xs:simpleType>';
const CPT_JSON=JSON.stringify({sondering:[{sondeernummer:"S1",sondeonderzoek:{penetratietest:{meetdata:[
  {lengte:1.12,diepte:1.1,qc:"12.000",fs:"60"},{lengte:1.52,diepte:1.5,qc:"10.000",fs:"50"},   // sand: Rf 0.5 %
  {lengte:2.22,diepte:2.2,qc:"0.500",fs:"25"},{lengte:2.62,diepte:2.6,qc:"0.600",fs:"30"}      // clay: Rf 5 %
]}}}]});
const XML={
  "2004-000010":"<interpretaties><formelestratigrafie><boring>B-near</boring><datum>2004-09-15</datum><laag><van>8</van><tot>10</tot><lid1>P1</lid1></laag></formelestratigrafie></interpretaties>",
  "1993-000011":"<interpretaties><formelestratigrafie><boring>B-near</boring><datum>1993-01-01</datum><laag><van>0</van><tot>6</tot><lid1>Br</lid1></laag><laag><van>6</van><tot>10</tot><lid1>XX</lid1></laag></formelestratigrafie></interpretaties>",
  "1876-000012":"<interpretaties><lithologischebeschrijving><boring>B-near</boring><laag><van>0</van><tot>10</tot><beschrijving>sable</beschrijving></laag></lithologischebeschrijving></interpretaties>"
};
const XSD_FORMAL='<xs:simpleType name="FormeleStratigrafieLedenEnumType"><xs:restriction><xs:enumeration value="Br"><xs:annotation><xs:documentation>Formatie van Brussel</xs:documentation></xs:annotation></xs:enumeration><xs:enumeration value="P1"><xs:annotation><xs:documentation>Groep van Onder Paleozoïcum</xs:documentation></xs:annotation></xs:enumeration></xs:restriction></xs:simpleType>';
const FILTER_JSON=JSON.stringify({filter:[{identificatie:"1",ligging:{regime:"FREATISCH"}}],filtermeting:[{referentiepunt:[{datum:"2009-09-16",meetpunt:30.12,referentie:"BOVENKANT_VAN_DE_PEILBUIS"}],peilmetingOrWaarnemingOrOnderkantPeilbuis:[{datum:"2026-03-16",peilMtaw:25.45,diepteTovReferentiepunt:4.67},{datum:"2026-04-14",peilMtaw:25.43,diepteTovReferentiepunt:4.69}]}]});
const seen=[];
const fakeFetch=async(url,init)=>{
  const u=new URL(url);seen.push({url:u,init});
  assert.equal(init.redirect,"manual");assert.equal(init.headers.accept,"*/*");assert.ok(init.signal);
  if(u.hostname==="geo.api.vlaanderen.be"&&u.pathname==="/VRBG2025/wfs"){
    assert.equal(u.searchParams.get("typeNames"),"VRBG2025:RefgemG100");
    if(u.searchParams.get("cql_filter")!=="NAAM='Leuven'")return new Response(JSON.stringify({features:[]}),{status:200});
    return new Response(JSON.stringify({features:[{properties:{NAAM:"Leuven",NISCODE:"24062"},geometry:{type:"Polygon",coordinates:[[[169120.4,168239.8],[178264.9,168239.8],[178264.9,181580.5],[169120.4,181580.5],[169120.4,168239.8]]]}}]}),{status:200});
  }
  if(u.hostname==="geo.api.vlaanderen.be"){
    const q=u.searchParams.get("q");
    if(q==="Leuven")return new Response(JSON.stringify({LocationResult:[{Municipality:"Leuven",LocationType:"basisregisters_gemeente",Location:{X_Lambert72:173726,Y_Lambert72:174699}}]}),{status:200});
    return new Response(JSON.stringify({LocationResult:/Leuven/.test(q)?[{Municipality:"Leuven",Housenumber:"1",FormattedAddress:"Grote Markt 1, 3000 Leuven",LocationType:"basisregisters_huisnummer",Location:{Lat_WGS84:50.879379,Lon_WGS84:4.700655,X_Lambert72:173358.14,Y_Lambert72:174387.29}}]:[]}),{status:200});
  }
  if(u.pathname==="/geoserver/wfs"){
    const t=u.searchParams.get("typeNames"),cql=u.searchParams.get("cql_filter");
    assert.ok(!/geom\b/.test(u.searchParams.get("propertyName")),"polygon geometry is never requested");
    let rows=LAYERS[t];if(!rows)return new Response("unknown layer",{status:400});
    const m=cql.match(/^(fiche|filterfiche|Proeffiche|gekoppeld_aan|gekoppeld_aan_link|Bodemlocatiefiche|Bodemtype)='([^']+)'$/);
    if(m)rows=m[1]==="Proeffiche"?(m[2].endsWith("2016-000001")?rows:[]):rows.filter(r=>r[m[1]]===m[2]);
    else if(/^gekoppeld_aan_link IN \(/.test(cql))rows=rows.filter(r=>cql.includes("'"+r.gekoppeld_aan_link+"'")&&cql.includes("'"+r.parameter+"'"));
    return new Response(fc(rows),{status:200});
  }
  if(u.pathname==="/geoserver/wms"){
    assert.equal(u.searchParams.get("request"),"GetFeatureInfo");assert.equal(u.searchParams.get("width"),"1");
    const p=PIXEL[u.searchParams.get("query_layers")];
    return new Response(JSON.stringify({type:"FeatureCollection",features:p?[{type:"Feature",properties:p}]:[]}),{status:200});
  }
  if(u.pathname.endsWith("HydrogeologischeStratigrafieDataCodes.xsd"))return new Response(XSD_HCOV,{status:200});
  if(u.pathname==="/xdov/proxy/export/json/sondering/2015-000003")return new Response(CPT_JSON,{status:200});
  const ex=u.pathname.match(/^\/xdov\/proxy\/export\/interpretatie\/(\d{4}-\d{6})$/);
  if(ex)return XML[ex[1]]?new Response(XML[ex[1]],{status:200}):new Response("",{status:404});
  if(u.pathname==="/xdov/proxy/export/json/filter/1978-006372")return new Response(FILTER_JSON,{status:200});
  if(u.pathname.endsWith("FormeleStratigrafieDataCodes.xsd"))return new Response(XSD_FORMAL,{status:200});
  return new Response("not found",{status:404});
};

// ---------- subsurface_at_location ----------
const loc=await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{address:"Grote Markt 1, 3000 Leuven"});
assert.equal(loc.location.matched_address,"Grote Markt 1, 3000 Leuven");assert.equal(loc.location.x_lambert72,173358.14);
assert.equal(loc.at_point.tertiary_geology.formation,"Formatie van Brussel");assert.equal(loc.at_point.soil.texture,"Zand");
assert.deepEqual(loc.at_point.drinking_water_protection_zone,[]);
assert.equal(loc.nearby.boreholes.count,2);assert.equal(loc.nearby.boreholes.nearest[0].id,"boring/2016-000001");assert.equal(loc.nearby.boreholes.nearest[0].distance_m,10);
assert.equal(loc.nearby.boreholes.with_stratigraphy,2);assert.equal(loc.nearby.groundwater_wells.nearest[0].id,"filter/1978-006372");
// modelled column: one GetFeatureInfo per model, units top-down with depths below the model ground, absent and zero-thickness units dropped,
// G3D names from the generated table (KR_... is Cretaceous, not the Paleogene unit with the same short code), H3D names from the HCOV list
const mc=loc.modelled_column;
assert.deepEqual(mc.geology.map(u=>[u.from_m,u.to_m??null,u.unit]),[[0,3.9,"010103Q_GtDi_GtTi_GtOg"],[3.9,22.6,"0310PA_Br"],[22.6,54.1,"031603PA_KoOr"],[54.1,159.9,"0402KR_Ne_Do_Gu_Va_Be_Vg_Es_Ms"],[159.9,null,"10SI_11OR_12CM"]]);
assert.equal(mc.geology[1].name,"Formatie van Brussel");assert.equal(mc.geology[3].era,"Cretaceous");assert.match(mc.geology[3].name,/Nevele/);
assert.deepEqual(mc.hydrogeology.map(u=>[u.from_m,u.to_m??null,u.unit,u.name??null]),[[0,3.9,"A0152",null],[3.9,22.6,"A0620","Zand van Brussel"],[22.6,159.9,"A1103",null],[159.9,null,"A1340","Cambro-Siluur Massief van Brabant"]]);
assert.equal(mc.ground_level_m_taw,26.68);assert.equal(mc.max_depth_m,300);assert.equal(mc.deeper_units,undefined);
const shallow=(await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{address:"Grote Markt 1, 3000 Leuven",max_depth_m:50})).modelled_column;
assert.deepEqual(shallow.geology.map(u=>u.unit),["010103Q_GtDi_GtTi_GtOg","0310PA_Br","031603PA_KoOr"]);
assert.deepEqual(shallow.deeper_units.geology,{units:2,deepest_from_m:159.9});
assert.equal(loc.groundwater_status_nearest.trend,"rising");assert.match(loc.groundwater_status_nearest.level_class,/very low/);
assert.match(loc.provenance.citation,/^Databank Ondergrond Vlaanderen – .*Boringen.* – geraadpleegd op \d\d\/\d\d\/\d{4}, op https:\/\/www\.dov\.vlaanderen\.be$/);
assert.match(loc.provenance.geocoding,/Digitaal Vlaanderen/);
const dw=seen.find(s=>s.url.searchParams.get("typeNames")==="dov-pub:Boringen").url.searchParams.get("cql_filter");
assert.equal(dw,"DWITHIN(geom,POINT(173358.14 174387.29),250,meters)");
// inputs are numbers only, clamped, and checked against Flanders before anything is requested
seen.length=0;
const r2=await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{latitude:50.879379482656915,longitude:4.7006545962260091,radius_m:99999});
assert.equal(r2.radius_m,500);assert.equal(r2.location.y_lambert72,174387.29);
assert.ok(seen.every(s=>s.url.hostname!=="geo.api.vlaanderen.be"),"coordinates need no geocoding");
seen.length=0;
assert.match((await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{latitude:50.6326,longitude:5.5797})).error,/outside the Flemish Region/);   // Liège
assert.match((await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{latitude:48.85,longitude:2.35})).error,/outside Belgium/);
assert.match((await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{x_lambert72:"1 1)) OR (1=1",y_lambert72:5})).error,/Give an address/);
assert.equal(seen.length,0,"rejected inputs make no upstream request");
assert.match((await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{address:"Nergensstraat 9, 9999 Nergens"})).error,/Address not found/);

// ---------- get_subsurface_record ----------
const b=await getSubsurfaceRecord(makeDovClient({fetchImpl:fakeFetch}),{id:"https://www.dov.vlaanderen.be/data/boring/2016-000001"});
assert.equal(b.name,"B-near");
// of two formal stratigraphies the one that covers more depth (1993, 0-10 m) wins over the newer partial one (2004, 8-10 m)
assert.equal(b.interpretations[0].id,"interpretatie/1993-000011");assert.equal(b.interpretations[0].layers[0].lid1_meaning,"Formatie van Brussel");
assert.equal(b.interpretations[0].layers[1].lid1_meaning,undefined,"unknown codes stay raw");
assert.equal(b.interpretations[1].layers[0].description,"sable");
assert.deepEqual(b.other_interpretations.map(i=>i.id),["interpretatie/2004-000010"]);
const cpt=await getSubsurfaceRecord(makeDovClient({fetchImpl:fakeFetch}),{id:"sondering/2015-000003"});
assert.deepEqual(cpt.profile_per_metre.map(r=>[r.from_m,r.soil_behaviour.split(":")[0],r.fs_mean_kpa]),[[1,"sand",55],[2,"clay",27.5]]);
assert.equal(cpt.profile_per_metre[1].friction_ratio_pct,5);assert.match(cpt.note,/fs sleeve friction in kPa/);
const f=await getSubsurfaceRecord(makeDovClient({fetchImpl:fakeFetch}),{id:"filter/1978-006372"});
// groundwater quality: latest sample in full (grouped, detection limits marked), indicator trend over the samples in date order
const gq=f.groundwater_quality;
assert.equal(gq.latest_sample.id,"monster/2025-000002");assert.equal(gq.latest_sample.results.Anionen[0].value,14.384);
assert.equal(gq.latest_sample.results["Zware metalen"][0].below_detection_limit,true);
assert.deepEqual(gq.trends["Nitraat (NO3)"].values,[{date:"2021-08-13",value:16.744},{date:"2025-03-14",value:14.384}]);
const ws=seen.find(s=>s.url.searchParams.get("typeNames")==="gw_meetnetten:grondwatermonsters").url;
assert.equal(ws.searchParams.get("cql_filter"),"gekoppeld_aan='|filter:1978-006372|'");assert.equal(ws.searchParams.get("sortBy"),"bemonsteringsdatum DESC");
assert.equal(f.regime,"freatisch");assert.equal(f.water_levels.latest.level_m_taw,25.43);assert.equal(f.reference_point.height_m_taw,30.12);
assert.match((await getSubsurfaceRecord(makeDovClient({fetchImpl:fakeFetch}),{id:"boring/2000-999999"})).error,/No public DOV borehole/);
assert.match((await getSubsurfaceRecord(makeDovClient({fetchImpl:fakeFetch}),{id:"https://evil.example/x"})).error,/Pass an id/);

// ---------- upstream guards ----------
const c=makeDovClient({fetchImpl:fakeFetch});
assert.match((await c.get("https://evil.example/geoserver/wfs")).error,/not allowed/);
assert.match((await c.get("http://www.dov.vlaanderen.be/x")).error,/not allowed/);
assert.match((await c.get("https://user:pw@www.dov.vlaanderen.be/x")).error,/not allowed/);
const redirect=makeDovClient({fetchImpl:async()=>new Response(null,{status:302,headers:{location:"https://evil.example/"}})});
assert.match((await redirect.get("https://www.dov.vlaanderen.be/data/boring/1")).error,/HTTP 302/,"redirects are not followed");
const huge=makeDovClient({fetchImpl:async()=>new Response(new Uint8Array(3<<20),{status:200})});
assert.ok((await huge.get("https://www.dov.vlaanderen.be/x",{maxBytes:1<<20})).tooLarge,"bodies are cut at the byte cap");
const slow=makeDovClient({fetchImpl:async()=>{throw Object.assign(new Error("t"),{name:"TimeoutError"})}});
assert.match((await slow.get("https://www.dov.vlaanderen.be/x")).error,/did not answer/);
const budget=makeDovClient({fetchImpl:fakeFetch});for(let i=0;i<20;i++)await budget.get("https://www.dov.vlaanderen.be/none");
assert.match((await budget.get("https://www.dov.vlaanderen.be/none")).error,/budget/);
const down=await subsurfaceAtLocation(makeDovClient({fetchImpl:async()=>new Response("",{status:503})}),{x_lambert72:173358,y_lambert72:174387});
assert.match(down.error,/did not answer/);

// ---------- through the MCP endpoint ----------
const env={ASSETS:{fetch:async()=>new Response("{}",{status:404})}};
const call=async(name,args,dov)=>{
  const r=await handleMcp(new Request("https://desk.example/mcp",{method:"POST",body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})}),env,{dov});
  return(await r.json()).result;
};
const ok=await call("subsurface_at_location",{address:"Grote Markt 1, 3000 Leuven"},{fetchImpl:fakeFetch,rateLimit:async()=>true});
assert.equal(ok.isError,false);assert.equal(ok.structuredContent.nearby.boreholes.count,2);
assert.match((await call("get_subsurface_record",{id:"filter/1978-006372"},{fetchImpl:fakeFetch,rateLimit:async()=>false})).structuredContent.error,/Too many/);
assert.match((await call("get_subsurface_record",{id:"filter/1978-006372"},null)).structuredContent.error,/not available/);

// ---------- permits, soil profiles, key facts ----------
assert.equal(operatorName({exploitant_naam:"Janssens Jan"}),null,"private persons are not named");
assert.equal(operatorName({exploitant_naam:"Janssens Jan",exploitant_KBOnr:"0123456789"}),"Janssens Jan","a KBO-registered enterprise is named");
assert.equal(operatorName({exploitant_naam:"Gemeente Zandhoven"}),"Gemeente Zandhoven");assert.equal(operatorName({exploitant_naam:"FINGO - FREDERICKX"}),"FINGO - FREDERICKX");
const L2=await subsurfaceAtLocation(makeDovClient({fetchImpl:fakeFetch}),{address:"Grote Markt 1, 3000 Leuven"});
const gp=L2.nearby.groundwater_permits;
assert.equal(gp.count,3);assert.equal(gp.radius_m,1000);assert.equal(gp.licensed_m3_per_year,2432500);
assert.deepEqual(gp.by_aquifer[0],{aquifer:"A0620: Zand van Brussel",permits:2,licensed_m3_per_year:2427500});
assert.equal(gp.nearest[0].operator,"not named (private person or unregistered operator)");assert.equal(gp.nearest[0].sector,"Fokken van varkens");
assert.ok(!JSON.stringify(L2).includes("Janssens"),"a private name never appears anywhere in the answer");
assert.equal(L2.nearby.soil_profiles.nearest[0].id,"bodemlocatie/1964-007478");
// the nearest pumping well's distance is in the key fact, not only in the nearby block
assert.ok(L2.key_facts.some(f=>new RegExp("^3 groundwater abstraction permit\\(s\\) \\(pumping wells\\) within 1000 m; nearest "+gp.nearest[0].distance_m+" m away.*; licensed for 2\\.43 million m³ a year in total, mostly from A0620").test(f)),JSON.stringify(L2.key_facts));
assert.ok(L2.key_facts.some(f=>/^Modelled column \(3D model, not observed\): Lid van Dilsen/.test(f)));
assert.ok(L2.key_facts.includes("Not in a drinking-water protection zone."));
// soil profile: horizons in order with Munsell colour assembled, lab values matched to the horizon by depth, other profiles at the same
// point ignored, boilerplate descriptions dropped, the Belgian code decoded with the soil-map legend
const sp=await getSubsurfaceRecord(makeDovClient({fetchImpl:fakeFetch}),{id:"https://www.dov.vlaanderen.be/data/bodemlocatie/1964-007478"});
assert.deepEqual(sp.horizons.map(h=>[h.horizon,h.from_cm,h.to_cm]),[["A1",0,22],["B2h",22,42]]);
assert.equal(sp.horizons[0].munsell_colour,"10YR 3/1");assert.equal(sp.horizons[0].organic_carbon_pct,3.2);assert.equal(sp.horizons[0].description,undefined);
assert.equal(sp.horizons[1].ph_kcl,3.65);assert.equal(sp.horizons[1].description,"zwarte humusaanrijkingshorizont");
assert.deepEqual(sp.site,{groundwater_table_cm:90,drainage_class:"goed gedraineerd"});
assert.equal(sp.classification[0].texture,"Zand");assert.equal(sp.classification[1].code,"Albic Podzol");

// ---------- search_subsurface ----------
const S=(a)=>searchSubsurface(makeDovClient({fetchImpl:fakeFetch}),a);
seen.length=0;
const s1=await S({record_type:"groundwater_permits",municipality:"Leuven",aquifer:"A0620",min_annual_m3:1000});
assert.equal(s1.area.municipality,"Leuven");assert.equal(s1.area.nis_code,"24062");assert.equal(s1.summary.licensed_m3_per_year,2432500);
const sq=seen.find(s=>s.url.searchParams.get("typeNames")==="gw_vergunningen:huidige_verg"&&s.url.searchParams.get("sortBy")).url;
assert.equal(sq.searchParams.get("sortBy"),"vergund_jaardebiet DESC");
assert.equal(sq.searchParams.get("cql_filter"),"INTERSECTS(geom,MULTIPOLYGON(((169120 168240,178265 168240,178265 181581,169120 181581,169120 168240)))) AND vergund_jaardebiet>=1000 AND (aquifer_HCOVv2_vergunning LIKE 'A062%') AND vergund_jaardebiet IS NOT NULL");
assert.ok(!JSON.stringify(s1).includes("Janssens"));
const s2=await S({record_type:"groundwater_wells",address:"Grote Markt 1, 3000 Leuven",aquifer:"Brussel",with_quality_data:true});
assert.equal(s2.sort,"nearest");assert.equal(s2.results[0].id,"filter/1978-006372");assert.equal(s2.results[0].distance_m,42);assert.equal(s2.filters.aquifer,"A0620");
for(const [bad,re] of [[{record_type:"rocks"},/record_type must be/],[{record_type:"boreholes",date_from:"2020') OR (1=1"},/date_from must be/],[{record_type:"boreholes",purpose:"mining"},/purpose must be/],
  [{record_type:"cpts",aquifer:"A0620"},/aquifer applies/],[{record_type:"boreholes",sort:"nearest"},/needs an address/],[{record_type:"boreholes",municipality:"Leuven",address:"x"},/either a municipality/],
  [{record_type:"boreholes",municipality:"Atlantis"},/not found/],[{record_type:"groundwater_permits",sort:"deepest_first"},/sort for groundwater_permits/]])
  assert.match((await S(bad)).error,re,JSON.stringify(bad));

console.log(JSON.stringify({ok:true,dov:"coordinates/ids/xml/levels/location/records/permits/soil/search/guards/mcp"}));
