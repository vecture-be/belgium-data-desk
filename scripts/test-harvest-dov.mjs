// DOV's model layers fold into one record per model version; the rest stay individual. Titles are DOV's own (16 Nov 2026).
import assert from "node:assert/strict";
import { groupDov, layerKind, layerUnit, unionBbox, blurb, collectionsFromCapabilities, DOV_LICENSE } from "./harvest-dov.mjs";

const BOX=[2.5234,50.3045,5.9474,51.5693];
const col=(id,title,description="",bbox=BOX)=>({id,title,description,extent:{spatial:{bbox:[bbox]}}});
const G31="Deze laag geeft de isohypsen van de basis van het Lid van Achterbos, zoals gedefinieerd in het Geologisch 3D model van de Vlaamse ondergrond - versie 3.1. Het Geologisch 3D model is opgemaakt in het kader van de beheersovereenkomst van de Vlaamse overheid met VITO, onder de noemer VLAKO, in opdracht van het Vlaams Planbureau voor Omgeving";
const OA="Deze laag geeft de boringen doorheen Ongedifferentieerd lid van de Formatie van Arenberg, zoals gedefinieerd in het Ondiep geologisch 3D lagen- en voxelmodel van regio Antwerpen (OA v1.1, 2023). Het ondiep model is een testcase voor het modelleren van de ondiepe stedelijke ondergrond.";

{ // layer kinds and units, across the title styles of the models and the map series
  const k=(t,kind,unit)=>{assert.equal(layerKind(t),kind,t);assert.equal(layerUnit(t),unit,t)};
  k("G3Dv3.1 010101, isohypsen van basis Ld van Achterbos van de Fm van Gent","basis","Ld van Achterbos van de Fm van Gent");
  k("G3Dv3 0305, isohypsen van top Fm van Borgloon","top","Fm van Borgloon");
  k("H3Dv2 A0240, isopachen Kleiige zanden van Kattendijk en Kasterlee","dikte","Kleiige zanden van Kattendijk en Kasterlee");
  k("G3Dv3 0305, breuken in top Fm van Zelzate","breuken","Fm van Zelzate");
  k("G3Dv2_0101, boringen met basis Fm van Weelde","boringen","Fm van Weelde");
  k("OAv1.1 010301, sonderingen met Fm van Lillo","sonderingen","Fm van Lillo");
  k("G3Dv3.1 indexkaart voorkomensgrenzen","overig",null);
  k("H3O-De Kempen - Hydrogeologie- Breuken Zand van Eigenbilzen","breuken","Zand van Eigenbilzen");
  k("H3O-Roerdalslenk - Algemene lagen - Breuken aan het maaiveld waarneembaar","breuken",null);
  k("H3O-Roerdalslenk - Algemene lagen - Aandachtspunten","overig",null);
  k("Grondmechanische kaart 15.3.6 Antwerpen-Centrum, Plaat III: Dikte van het alluvium (vector)","dikte",null);   // map plates list sheets, not units
  k("Grondmechanische kaart 15.3.5 Zwijndrecht-Zuid, Plaat VIII: Zonering (vector)","zonering",null);
}
{ // a bbox in Lambert metres declared as CRS84 is left out of the union
  assert.deepEqual(unionBbox([col("a","a","",[5.13,50.52,6.37,51.76]),col("b","b","",[5.2,50.6,218863.4,186037.4])]),[5.13,50.52,6.37,51.76]);
  assert.equal(unionBbox([col("b","b","",[150000,200000,160000,210000])]),null);
}
{ // the blurb drops the per-layer first sentence without cutting at "versie 3.1" or "(OA v1.1, 2023)"
  assert.match(blurb([col("x","x",G31)]),/^Het Geologisch 3D model is opgemaakt/);
  assert.match(blurb([col("x","x",OA)]),/^Het ondiep model is een testcase/);
  assert.equal(blurb([col("x","x","Korte tekst.")]),"");
}
{ // grouping: one record per model version (H3O split by area), the rest individual
  const cs=[
    col("g3dv3:g3dv3_0305_Bo_t_ih","G3Dv3 0305, isohypsen van top Fm van Borgloon"),
    col("g3dv3_1:g3dv3_1_010101Q_GtAb_b_ih","G3Dv3.1 010101, isohypsen van basis Ld van Achterbos van de Fm van Gent",G31),
    col("g3dv3_1:g3dv3_1_0305_Bo_t_ih","G3Dv3.1 0305, isohypsen van top Fm van Borgloon",G31),
    col("g3dv3_1:g3dv3_1_0305_Bo_br","G3Dv3.1 0305, breuken in top Fm van Borgloon",G31),
    col("h3o:rds_alg_aandachtspunten","H3O-Roerdalslenk - Algemene lagen - Aandachtspunten","Deze polygoon geeft de algemene aandachtspunten weer. Aandachtspunten is een kaartlaag die deel uitmaakt van de dataset."),
    col("h3o:kmp_hg_br_eb","H3O-De Kempen - Hydrogeologie- Breuken Zand van Eigenbilzen"),
    col("gmk:kb_15_3_6_p3_v","Grondmechanische kaart 15.3.6 Antwerpen-Centrum, Plaat III: Dikte van het alluvium (vector)"),
    col("gmk:kb_15_3_5_p8_v","Grondmechanische kaart 15.3.5 Zwijndrecht-Zuid, Plaat VIII: Zonering (vector)"),
    col("pfas:pfas_afvalwater","PFAS in afvalwater - Metingen"),
    col("erosie:potential_soil_erosion","Potential soil erosion aggregated for a grid of 1 km by 1 km in Flanders")
  ];
  const {series,individual}=groupDov(cs,{timeStamp:"2026-11-16T06:00:00Z"});
  assert.deepEqual(individual.map(c=>c.id),["pfas:pfas_afvalwater","erosie:potential_soil_erosion"]);
  assert.deepEqual(series.map(s=>s.datasetId).sort(),["g3dv3","g3dv3_1","gmk","h3o-h3o-de-kempen","h3o-h3o-roerdalslenk"]);
  const g=series.find(s=>s.datasetId==="g3dv3_1");
  assert.equal(g.id,"harvest:dov:series:g3dv3_1");
  assert.equal(g.title,"G3Dv3.1 – Geologisch 3D-model van de Vlaamse ondergrond, versie 3.1");
  assert.equal(g.layerCount,3);assert.equal(g.layers.length,3);assert.equal(g.license,DOV_LICENSE);
  assert.match(g.description,/^3 kaartlagen \(OGC API Features: GeoJSON, CSV\): (basis|breuken|top) 1, (basis|breuken|top) 1, (basis|breuken|top) 1\. 2 eenheden, o\.a\. Ld van Achterbos van de Fm van Gent; Fm van Borgloon\. Het Geologisch 3D model is opgemaakt/);
  assert.match(series.find(s=>s.datasetId==="g3dv3").description,/^Vorige versie; opgevolgd door G3Dv3\.1\. /);
  assert.ok(g.distributions[0].url.startsWith("https://www.dov.vlaanderen.be/geoserver/ogc/features/v1/collections/g3dv3_1%3A"));assert.deepEqual(g.distributions.map(d=>d.format).slice(0,2),["GeoJSON","CSV"]);
  assert.deepEqual(g.extent.spatial,BOX);assert.equal(g.updatedAt,"2026-11-16T06:00:00Z");
  const rds=series.find(s=>s.datasetId==="h3o-h3o-roerdalslenk");
  assert.equal(rds.title,"H3O-Roerdalslenk – geologisch en hydrogeologisch 3D-model van de Roerdalslenk");
  assert.doesNotMatch(rds.description,/Aandachtspunten is een kaartlaag/,"H3O layer texts are not model descriptions");
  const gmk=series.find(s=>s.datasetId==="gmk");
  assert.match(gmk.description,/2 kaartbladen, o\.a\. 15\.3\.6 Antwerpen-Centrum; 15\.3\.5 Zwijndrecht-Zuid\./);
  assert.ok(!gmk.themes.includes("3D-model"));
  // a superseded version names its successor (the index ranks it just below its peers); the current one does not
  assert.equal(series.find(s=>s.datasetId==="g3dv3").successor,"G3Dv3.1");
  assert.equal(g.successor,undefined);
}
{ // the WFS GetCapabilities listing, in DOV's own XML shape: ids, titles with entities, abstract, WGS84 box
  const xml='<?xml version="1.0"?><wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1"><FeatureTypeList>'+
    '<FeatureType xmlns:pfas="http://dov.vlaanderen.be/pfas"><Name>pfas:lantis_bodem</Name><Title>PFAS in de bodem Lantis (&#181;g/kg ds) - Totalen</Title>'+
    '<Abstract>Metingen &amp; totalen</Abstract><ows:Keywords><ows:Keyword>PFAS</ows:Keyword></ows:Keywords><DefaultCRS>urn:ogc:def:crs:EPSG::31370</DefaultCRS>'+
    '<ows:WGS84BoundingBox><ows:LowerCorner>4.25 51.17</ows:LowerCorner><ows:UpperCorner>4.45 51.26</ows:UpperCorner></ows:WGS84BoundingBox></FeatureType>'+
    '<FeatureType><Name>g3dv3_1:g3dv3_1_0305_Bo_t_ih</Name><Title>G3Dv3.1 0305, isohypsen van top Fm van Borgloon</Title><Abstract/></FeatureType>'+
    '</FeatureTypeList></wfs:WFS_Capabilities>';
  const cs=collectionsFromCapabilities(xml);
  assert.deepEqual(cs.map(c=>c.id),["pfas:lantis_bodem","g3dv3_1:g3dv3_1_0305_Bo_t_ih"]);
  assert.equal(cs[0].title,"PFAS in de bodem Lantis (µg/kg ds) - Totalen");
  assert.equal(cs[0].description,"Metingen & totalen");
  assert.deepEqual(cs[0].extent.spatial.bbox,[[4.25,51.17,4.45,51.26]]);
  assert.deepEqual(cs[1].extent,{});
  const {series,individual}=groupDov(cs);
  assert.equal(series.length,1);assert.equal(individual[0].id,"pfas:lantis_bodem");
}
console.log(JSON.stringify({ok:true,tests:"DOV series grouping, layer kinds and units, bbox and blurb, WFS capabilities"}));
