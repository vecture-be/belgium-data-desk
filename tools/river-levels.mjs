import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { RIVER_HOSTS, RIVER_LIMITS, riverLevels } from "../rivers.mjs";

export default defineTool({
  name:"river_levels",
  title:"River, canal and tide levels in Flanders now and forecast (waterinfo.be)",
  description:"Live water levels at about 650 river, canal and tidal gauges in Flanders and on the Flemish waterways (VMM and HIC, waterinfo.be): the nearest gauges to an address or point, a named gauge, or the gauges on a river. For each gauge: the level now in metres TAW (and above the gauge zero where that is how it is published), the change over 1, 3 and 24 hours (rising/falling/steady, or low and high water for tidal gauges), the 24-hour minimum and maximum, how far it is below the gauge's official watch and alarm levels, whether it is within its usual range (the long-term band of 80 % of the time), the publisher's official alarm status and its short-term forecast status, and, at about 360 gauges, the publisher's own water-level forecast for the next 48-60 hours (peak level and time, rise, when the watch or alarm level would be reached, forecast rain over the catchment; for tidal gauges the next high and low waters). Starts with key_facts. Values are provisional measurements updated every 5-15 minutes. Does not say whether a specific address will flood (use flood_risk for Flanders' official flood-prone maps), and does not cover Wallonia (SPW's terms forbid passing its gauge data on), Brussels' Flowbru gauges or discharge. Forecasts are deterministic model runs, not certainties.",
  inputSchema:{type:"object",properties:{
    address:{type:"string",description:"Address or place, e.g. 'Grote Markt 1, 3000 Leuven': the nearest gauges are returned."},
    ...COORDINATE_PROPERTIES,
    station:{type:"string",description:"A gauge by name or number instead of a place, e.g. 'Korbeek-Dijle', 'L08_097', 'Werchter', 'Antwerpen tij'."},
    river:{type:"string",description:"Only gauges on this river or canal, e.g. 'Demer', 'Zeeschelde', 'Dender', 'Kanaal Gent-Terneuzen'; combine with an address to get that stretch."},
    radius_km:{type:"number",minimum:1,maximum:RIVER_LIMITS.radiusKm.max,description:"Search radius around the place in km, default "+RIVER_LIMITS.radiusKm.default+"."},
    max_stations:{type:"integer",minimum:1,maximum:RIVER_LIMITS.stations.max,description:"How many gauges to return, default "+RIVER_LIMITS.stations.default+"."}
  }},
  source:{publisher:"Vlaamse Milieumaatschappij (VMM) and Hydrologisch Informatiecentrum (HIC), via waterinfo.be",
    licence:"Modellicentie Gratis Hergebruik",url:"https://www.waterinfo.be"},
  hosts:[...RIVER_HOSTS,...GEOCODER_HOSTS],
  maxRequests:20,
  run:riverLevels,
  examples:[
    {args:{station:"Korbeek-Dijle"},note:"How high is the Dijle at Korbeek-Dijle, and how far from the alarm level?",replay:true},
    {args:{address:"Grote Markt 1, 3290 Diest",river:"Demer"},note:"Is the Demer rising near Diest?"},
    {args:{address:"Korenmarkt 1, 9000 Gent",radius_km:5},note:"Water levels around Ghent now"},
    {args:{latitude:51.2213,longitude:4.3977,max_stations:2},note:"When is high tide in the Scheldt at Antwerp?"}
  ],
  routing:{words:/^(waterstand|waterstanden|waterpeil|waterpeilen|rivierpeil|waterhoogte|hauteur|hauteurs|crue|crues|limnimetre|limnimetrie|hoogwater|getij|maree|gauge|gauges|hoogtij|laagtij|eb|vloed|tij|tide|tides)$/,
    hint:"For the water level of a river, canal or the tide in Flanders now and its forecast, river_levels reads the live gauges and forecasts of VMM and HIC (waterinfo.be)."}
});
