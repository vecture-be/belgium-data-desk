import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { MODEL_DEPTH, RADIUS, subsurfaceAtLocation } from "../dov.mjs";

export default defineTool({
  name:"subsurface_at_location",
  title:"Soil, geology and groundwater at a place in Flanders",
  description:"What is under a location in Flanders, read live from Databank Ondergrond Vlaanderen (DOV), the Flemish Government's subsurface database: the soil-map unit, the Tertiary and Quaternary geological map units and the groundwater bodies at the point, whether it lies in a drinking-water protection zone, the modelled column of geological and hydrogeological (aquifer) units with depths from DOV's 3D models (an answer even where no borehole exists), the boreholes, cone penetration tests (CPT) and groundwater monitoring wells within radius_m (counts plus the nearest and deepest, with ids), groundwater abstraction permits and described soil profiles within at least 1 km (licensed volume per aquifer; names of private persons withheld), and the current shallow groundwater status at the nearest status well. Starts with key_facts: the answer in a few sentences. Give an address in Flanders, or latitude/longitude, or Lambert 72 x/y. Use get_subsurface_record with a returned id for layer-by-layer borehole logs, CPT profiles or groundwater levels and quality. Map units and the model column are map- and model-scale information, not a site investigation.",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address in Flanders, e.g. 'Grote Markt 1, 3000 Leuven'. Looked up in the Flemish address register."},
    ...COORDINATE_PROPERTIES,
    radius_m:{type:"integer",minimum:RADIUS.min,maximum:RADIUS.max,description:"Search radius for boreholes, CPTs and wells in metres, default "+RADIUS.default+"."},
    max_depth_m:{type:"integer",minimum:MODEL_DEPTH.min,maximum:MODEL_DEPTH.max,description:"Deepest unit start listed in the modelled column, default "+MODEL_DEPTH.default+" m; deeper units are counted. Raise it for deep geothermal or deep aquifer questions."}
  }},
  source:{publisher:"Databank Ondergrond Vlaanderen (DOV), Flemish Government",licence:"Modellicentie Gratis Hergebruik",url:"https://www.dov.vlaanderen.be"},
  hosts:["www.dov.vlaanderen.be",...GEOCODER_HOSTS],
  maxRequests:20,
  run:subsurfaceAtLocation,
  examples:[
    {args:{address:"Grote Markt 1, 3000 Leuven"},note:"What is under the Grote Markt in Leuven?",replay:true},
    {args:{latitude:51.2194,longitude:4.4025,radius_m:500,max_depth_m:1000},note:"Deep aquifers and boreholes near Antwerp central station, for a geothermal question"}
  ],
  routing:{words:/^(boring|boringen|boorgat|borehole|boreholes|forage|forages|sondering|sonderingen|cpt|grondwater|groundwater|nappe|phreatic|freatisch|aquifer|aquifers|bodem|bodemkaart|soil|soils|geolog|geology|geologie|geologique|ondergrond|subsurface|stratigrafie|stratigraphy|lithologie|lithology|dov|geothermie|geothermal)/,
    hint:"For soil, geology, boreholes or groundwater at a specific place in Flanders, this tool reads Databank Ondergrond Vlaanderen live instead of listing its map layers."}
});
