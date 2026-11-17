import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { ZONING_HOSTS, zoningAtLocation } from "../zoning.mjs";

export default defineTool({
  name:"zoning_at_location",
  title:"Zoning and spatial plans at a place in Flanders (Departement Omgeving)",
  description:"What the spatial plans say about an address or point in Flanders, from the Department of Environment's official planning data (Digitaal Stedenbouwkundige Informatie) via Mercator. Names the land-use zone that applies: the most detailed plan in force (municipal, provincial or regional spatial implementation plan, special or general plan of development, or the regional zoning plan), with its code, category, publication date and a link to its rules, and lists the plans underneath. Also overlays, building-line and expropriation plans, municipal and provincial urban-development regulations, plans and regulations still in procedure (with participation dates), and permit applications filed through the Omgevingsloket since 2017 (type, works, status, link; applicants not named). Includes the municipality (NIS code). Flanders only. Starts with key_facts. Checks one point; it is not the official planning certificate (stedenbouwkundig uittreksel) and does not interpret the plan rules for a project. For heritage designations use heritage_at_location.",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address in Flanders, e.g. 'Tiensesteenweg 150, 3001 Leuven'."},
    ...COORDINATE_PROPERTIES
  }},
  source:{publisher:"Departement Omgeving (Flemish Department of Environment), via Mercator",licence:"Gratis Open Data Licentie Vlaanderen v1.2",url:"https://dsi.omgeving.vlaanderen.be"},
  hosts:[...ZONING_HOSTS,...GEOCODER_HOSTS],
  maxRequests:6,
  run:zoningAtLocation,
  examples:[
    {args:{address:"Tiensesteenweg 150, 3001 Leuven"},note:"What may be built at this address in Leuven?",replay:true},
    {args:{address:"Martelarenplein 20, 3000 Leuven"},note:"Which plan applies at Leuven station?"},
    {args:{latitude:51.0543,longitude:3.7174},note:"What is the zoning at this point in Ghent?"}
  ],
  routing:{words:/^(bestemming|bestemmingsplan|gewestplan|bpa|rup|ruimtelijk|uitvoeringsplan|stedenbouwkundig|stedenbouw|verkaveling|bouwgrond|bouwen|bouwvergunning|omgevingsvergunning|omgevingsloket|woongebied|zoning|zoned|landuse|zonage|urbanisme)$/,
    hint:"For what the spatial plans say about a place in Flanders (zone, plan, regulations, permit applications), zoning_at_location reads the Department of Environment's planning data for the address."}
});
