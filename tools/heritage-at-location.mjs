import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { HERITAGE_HOSTS, heritageAtLocation } from "../heritage.mjs";

export default defineTool({
  name:"heritage_at_location",
  title:"Heritage designations at a place in Flanders (Onroerend Erfgoed)",
  description:"Whether an address or point in Flanders is protected or listed heritage, and what that means for works and permits, from the Flemish heritage agency (Onroerend Erfgoed) via the public Mercator map service. Checks every legal designation at the point: protected monument, protected town or village view, protected landscape, protected archaeological site, transition zone, UNESCO core or buffer zone, fixed inventory of built or landscape heritage, fixed archaeological zone (archaeology note needed for smaller works), heritage landscape and area where no archaeology is expected (no archaeology note needed). Each comes with its name, id, date, the official decision link and what it means. Also the scientific inventory of built heritage (no legal effect), ratified archaeology notes at the point, protected monuments within 30 m, and the municipality (NIS code). Flanders only. Starts with key_facts. Checks one point, not a whole parcel; does not replace the permit procedure or give zoning (spatial plans).",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address in Flanders, e.g. 'Markt 1, 8000 Brugge'."},
    ...COORDINATE_PROPERTIES
  }},
  source:{publisher:"Agentschap Onroerend Erfgoed (Flemish heritage agency), via Mercator (Departement Omgeving)",licence:"Gratis Open Data Licentie Vlaanderen v1.2",url:"https://www.onroerenderfgoed.be"},
  hosts:[...HERITAGE_HOSTS,...GEOCODER_HOSTS],
  maxRequests:6,
  run:heritageAtLocation,
  examples:[
    {args:{address:"Markt 1, 8000 Brugge"},note:"Is the building on Bruges' Markt protected heritage?",replay:true},
    {args:{address:"Martelarenplein 20, 3000 Leuven"},note:"Is Leuven station a protected monument?"},
    {args:{latitude:51.2194,longitude:4.4025},note:"Which heritage rules apply at this point in Antwerp?"}
  ],
  routing:{words:/^(erfgoed|onroerend-erfgoed|monument|monumenten|beschermd|bescherming|vastgesteld|inventaris|archeologie|archeologienota|stadsgezicht|dorpsgezicht|unesco|werelderfgoed|heritage|listed|patrimoine|classé)$/,
    hint:"For whether a building or place in Flanders is protected or listed heritage and what that means for permits, heritage_at_location reads the heritage agency's designations at the address."}
});
