import { defineTool } from "../lib/tool-contract.mjs";
import { getSubsurfaceRecord } from "../dov.mjs";

export default defineTool({
  name:"get_subsurface_record",
  title:"Borehole, CPT or groundwater-well details from DOV",
  description:"Details of one DOV record by id from subsurface_at_location: for a borehole ('boring/…') its depth, purpose and layer-by-layer interpretations (formal stratigraphy with formation names, the logged lithological description, hydrogeological units) plus ids of further interpretations; for a groundwater screen ('filter/…') the aquifer, screen depth, water levels (latest, lowest, highest, last 12 readings, yearly means) and groundwater quality (every result of the latest lab sample, and trends of nitrate, chloride, sulphate, ammonium, conductivity and pH); for a CPT ('sondering/…') cone resistance and sleeve friction per metre with the Robertson soil behaviour type; for a soil profile ('bodemlocatie/…') its classification, site (water table, drainage, land use, parent material) and per horizon the Munsell colour, texture, organic carbon, pH and lime; or one interpretation ('interpretatie/…'). Codes are decoded with DOV's published code lists; every answer starts with key_facts.",
  inputSchema:{type:"object",properties:{id:{type:"string",description:"Record id such as 'boring/2016-140688', 'filter/1978-006372', 'sondering/1984-065526', 'bodemlocatie/1964-007478' or 'interpretatie/1993-088861' (a DOV URL for the record also works)."}},required:["id"]},
  source:{publisher:"Databank Ondergrond Vlaanderen (DOV), Flemish Government",licence:"Modellicentie Gratis Hergebruik",url:"https://www.dov.vlaanderen.be"},
  hosts:["www.dov.vlaanderen.be"],
  maxRequests:20,
  run:getSubsurfaceRecord,
  examples:[
    {args:{id:"boring/2016-140688"},note:"Layer-by-layer log of one borehole",replay:true},
    {args:{id:"filter/1978-006372"},note:"Water levels and groundwater quality at one monitoring screen"},
    {args:{id:"sondering/1984-065526"},note:"Soil behaviour per metre from one cone penetration test"}
  ]
});
