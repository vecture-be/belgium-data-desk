import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { WEATHER_HOSTS, weather } from "../weather.mjs";

export default defineTool({
  name:"weather",
  title:"Weather now, last days and 48-hour forecast in Belgium (KMI/IRM)",
  description:"The weather at an address or point in Belgium from the Royal Meteorological Institute (KMI/IRM) open data: what the nearest synoptic station measures now (temperature, wind and gusts, humidity, cloud cover, pressure), its last 24 hours (minimum, maximum, precipitation), the last 7 days at the nearest automatic station (daily rain, max/min, sunshine), and KMI's ALARO model forecast for that point for the next 48 hours (3-hourly for the first day: temperature, precipitation, snow, wind, gusts, cloud cover) with 24-hour summaries and when rain is first expected. Starts with key_facts. Observations come from a station up to tens of km away; the forecast is a single deterministic model run without probabilities. Does not give official weather warnings (not in KMI's open data), climate normals, rain radar or forecasts beyond about 60 hours.",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address or place in Belgium, e.g. 'Grote Markt 1, 3000 Leuven' or 'Place Saint-Lambert 1, 4000 Liège'."},
    ...COORDINATE_PROPERTIES
  }},
  source:{publisher:"Royal Meteorological Institute of Belgium (KMI/IRM)",licence:"CC BY 4.0",url:"https://opendata.meteo.be"},
  hosts:[...WEATHER_HOSTS,...GEOCODER_HOSTS],
  maxRequests:20,
  run:weather,
  examples:[
    {args:{address:"Grote Markt 1, 3000 Leuven"},note:"What is the weather in Leuven now, and will it rain tomorrow?",replay:true},
    {args:{address:"Place Saint-Lambert 1, 4000 Liège"},note:"Weather forecast for Liège for the next two days"},
    {args:{latitude:51.2194,longitude:2.9269},note:"How windy is it at the coast in Ostend?"}
  ],
  routing:{words:/^(weer|weerbericht|weersverwachting|weather|forecast|meteo|meteorologie|temperatuur|temperature|regen|rain|neerslag|precipitation|wind|storm|sneeuw|snow|pluie|neige|vent|kmi|irm|rmi|synop)$/,
    hint:"For the weather now, the last days or the next 48 hours at a place, weather answers from KMI/IRM's stations and ALARO forecast."}
});
