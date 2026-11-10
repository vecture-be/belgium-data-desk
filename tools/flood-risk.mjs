import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { floodRisk } from "../flood.mjs";

export default defineTool({
  name:"flood_risk",
  title:"Flood-prone classes at a place in Flanders (official VMM maps)",
  description:"Whether an address or point in Flanders is flood-prone on the official VMM maps of flood-prone areas from rivers (fluvial), heavy rain (pluvial) and the sea, each as class A (no flooding modelled), B (small chance under climate change), C (small chance) or D (medium chance). These maps underlie the flood information required when property in Flanders is sold or let and the water test for permits. Includes the municipality (NIS code) with its population and income. Flanders only. Starts with key_facts; describes the location, not a building's floor level or defences.",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address in Flanders, e.g. 'Groenplaats 1, 2000 Antwerpen'."},
    ...COORDINATE_PROPERTIES
  }},
  source:{publisher:"Vlaamse Milieumaatschappij (VMM), via waterinfo.be",licence:"Modellicentie Gratis Hergebruik",url:"https://www.waterinfo.be"},
  hosts:["inspirepub.waterinfo.be",...GEOCODER_HOSTS],
  maxRequests:8,
  run:floodRisk,
  examples:[
    {args:{address:"Grote Markt 1, 3000 Leuven"},note:"Is the Grote Markt in Leuven flood-prone?",replay:true},
    {args:{latitude:51.05,longitude:3.72},note:"Flood classes at a point in Ghent"}
  ],
  routing:{words:/^(overstroming|overstromingen|overstromingsgevoelig|flood|floods|flooding|inondation|inondations|wateroverlast|informatieplicht)/,
    hint:"For whether a place in Flanders is flood-prone, flood_risk reads VMM's official maps (classes A-D) for the address."}
});
