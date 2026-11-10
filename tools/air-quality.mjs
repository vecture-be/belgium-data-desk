import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { airQuality } from "../air.mjs";

export default defineTool({
  name:"air_quality",
  title:"Air quality at a place in Belgium (now, forecast, annual)",
  description:"Air quality at an address or point anywhere in Belgium from IRCEL-CELINE, read live: this hour's modelled NO2, PM2.5, PM10, ozone and black carbon for the 4 km cell, the last 24-hour PM means against the WHO 24-hour guidelines, the BelAQI forecast for today and the next three days (1 excellent to 10 horrible), annual means of the last complete year (street level in Flanders via ATMO-Street, 4 km background elsewhere) compared with the WHO 2021 guidelines and the current and 2030 EU limit values, and the nearest measuring stations that are reporting now (out-of-service stations are skipped and named). Includes the municipality (NIS code) with its population and income. Starts with key_facts; cite IRCEL-CELINE (CC BY 4.0).",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address in Belgium, e.g. 'Grote Markt 1, 3000 Leuven' or 'Place Saint-Lambert 1, 4000 Liège'."},
    ...COORDINATE_PROPERTIES
  }},
  source:{publisher:"IRCEL-CELINE (Belgian Interregional Environment Agency)",licence:"CC BY 4.0",url:"https://www.irceline.be"},
  hosts:["geo.irceline.be",...GEOCODER_HOSTS],
  maxRequests:16,
  run:airQuality,
  examples:[
    {args:{address:"Rue Neuve 1, 1000 Bruxelles"},note:"How is the air in central Brussels now, and over the year?",replay:true},
    {args:{address:"Place Saint-Lambert 1, 4000 Liège"},note:"Air quality forecast for Liège"},
    {args:{latitude:51.2194,longitude:4.4025},note:"Annual NO2 at street level near Antwerp central station"}
  ],
  routing:{words:/^(luchtkwaliteit|lucht|air|fijnstof|pm10|pm25|no2|ozon|ozone|belaqi|smog|pollution|vervuiling)/,
    hint:"For air quality at a place now, forecast or as an annual mean, air_quality reads IRCEL-CELINE live for the address."}
});
