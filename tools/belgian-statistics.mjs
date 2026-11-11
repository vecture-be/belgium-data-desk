import { defineTool } from "../lib/tool-contract.mjs";
import { belgianStatistics } from "../statbel.mjs";

export default defineTool({
  name:"belgian_statistics",
  title:"Official Belgian statistics: population, income, prices, labour market",
  description:"Answers with Statbel's official figures (not dataset links). Places: any of the 565 municipalities (2025 boundaries; Dutch, French or pre-merger names such as Melle work; NIS codes too), the provinces, the three regions or Belgium. topic 'profile' (default) gives population on 1 January (total, sex, age bands, non-Belgian nationality, change since 2019) and average net taxable income per inhabitant and per declaration (income years up to the latest published); a single municipality comes with its province, region and Belgium for comparison. rank_by ranks municipalities within a province, region or Belgium (e.g. highest income per inhabitant in Limburg, oldest population); with no places, topic 'population' or 'income' ranks the municipalities of Belgium by it. topic 'prices' gives the latest CPI, inflation and (smoothed) health index read live from Statbel; topic 'labour' gives the latest quarterly employment, unemployment and activity rates for Belgium and the regions (Labour Force Survey). Each answer starts with key_facts and states reference dates, definitions and the Statbel citation (CC BY 4.0).",
  inputSchema:{type:"object",properties:{
    places:{type:"array",items:{type:"string"},maxItems:6,description:"Up to 6 places to compare, e.g. ['Leuven','Gent'], ['Limburg','Wallonia','Belgium'] or ['44088']. A bare 'Brussels' means the region; use 'City of Brussels' for the municipality."},
    topic:{type:"string",enum:["profile","population","income","prices","labour"],description:"Default 'profile' (population and income)."},
    year:{type:"integer",description:"Population year (1 January), 2019 to the latest; default latest."},
    income_year:{type:"integer",description:"Income year, default the latest published."},
    rank_by:{type:"string",enum:["population","population_growth_pct","share_65_plus_pct","share_0_17_pct","non_belgian_nationality_pct","income_per_inhabitant","income_per_declaration"],description:"Rank municipalities by this indicator instead of listing places."},
    within:{type:"string",description:"With rank_by: a province, region or 'Belgium' (default)."},
    order:{type:"string",enum:["highest","lowest"],description:"With rank_by; default highest."},
    limit:{type:"integer",minimum:1,maximum:25,description:"With rank_by; default 10."},
    with_context:{type:"boolean",description:"Default true: one municipality is shown with its province, region and Belgium."}
  }},
  source:{publisher:"Statbel, the Belgian statistical office",licence:"CC BY 4.0",url:"https://statbel.fgov.be/en/open-data"},
  // statbel.fgov.be is limited to its open-data file folder by the client (its web pages sit behind a bot check)
  hosts:["statbel.fgov.be","bestat.statbel.fgov.be"],
  maxRequests:4,
  run:belgianStatistics,
  examples:[
    {args:{places:["Gent"],topic:"population"},note:"How many people live in Ghent?",replay:true},
    {args:{rank_by:"income_per_inhabitant",within:"Limburg",limit:5},note:"Which municipalities in Limburg have the highest income per inhabitant?"},
    {args:{topic:"prices"},note:"What is the current inflation and health index?"},
    {args:{topic:"labour"},note:"What is the unemployment rate in each region?"}
  ],
  routing:{words:/^(bevolking|inwoners|population|habitants|inhabitants|inkomen|income|revenus|inflatie|inflation|cpi|gezondheidsindex|consumptieprijs|werkloosheid|unemployment|chomage|tewerkstelling|employment)/,
    hint:"For the figures themselves (population, income, inflation, unemployment) by municipality, province or region, belgian_statistics answers with Statbel's official numbers."}
});
