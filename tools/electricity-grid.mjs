// electricity_grid: Belgium's electricity system now, on a past day or in the coming days, from Elia (the transmission system operator).
import { defineTool } from "../lib/tool-contract.mjs";
import { ELIA_HOSTS, electricityGrid } from "../elia.mjs";

export default defineTool({
  name:"electricity_grid",
  title:"Belgian electricity: consumption, solar, wind, imports, prices now and forecast (Elia)",
  description:"Belgium's electricity system from Elia's open data (the transmission system operator). Without a date: the latest quarter-hour of consumption (total load), solar and wind production and their share, net imports or exports per border, today's and tomorrow's peak load and solar and wind energy, the latest imbalance price with today's range and negative-price quarter-hours, and yesterday's generation mix by fuel (nuclear, gas, wind, solar...) with its CO2 intensity. With a past date (from 2015; solar from October 2020, mix from 2020, imbalance prices from 22 May 2024, CO2 from October 2024): that day's consumption, peak, solar, wind, border flows, imbalance prices, mix and CO2. With a future date (up to 10 days): Elia's forecast of load (7 days), solar (10) and wind (6). Days are Brussels days; values are quarter-hour averages in MW, energies in GWh. Solar and wind are Elia's estimates for all installations, rooftop panels included. Does not give the day-ahead market price (EPEX SPOT), household tariffs, outages at an address or gas-network data.",
  inputSchema:{type:"object",properties:{
    date:{type:"string",description:"A Brussels day as YYYY-MM-DD, e.g. '2026-11-15', or 'today', 'tomorrow', 'yesterday'. Default today (the situation now)."}
  }},
  source:{publisher:"Elia Transmission Belgium SA (Elia Open Data)",licence:"CC BY 4.0",url:"https://opendata.elia.be"},
  hosts:ELIA_HOSTS,
  maxRequests:10,
  run:electricityGrid,
  examples:[
    {args:{},note:"How much of Belgium's electricity comes from solar and wind right now, and is Belgium importing?",replay:true},
    {args:{date:"tomorrow"},note:"How much solar and wind power is expected in Belgium tomorrow?"},
    {args:{date:"2026-06-21"},note:"How much solar power did Belgium produce on 21 June 2026, and were there negative prices?"}
  ],
  routing:{words:/^(elia|elektriciteit|electricity|electricite|électricité|stroom|stroomnet|stroomverbruik|stroomproductie|elektriciteitsverbruik|elektriciteitsproductie|hoogspanningsnet|energiemix|stroommix|kernenergie|kerncentrale|kerncentrales|zonnestroom|windstroom|onbalans|onbalansprijs|imbalance|déséquilibre|desequilibre)$/,
    hint:"For Belgium's electricity now, on a past day or in the coming days (consumption, solar, wind, imports, imbalance price, generation mix, CO2), electricity_grid answers from Elia's open data."}
});
