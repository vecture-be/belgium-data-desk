// real_estate_prices: what homes sell for in a Belgian place, from Statbel's real-estate sales statistics (realestate.mjs).
import { defineTool } from "../lib/tool-contract.mjs";
import { realEstatePrices } from "../realestate.mjs";

export default defineTool({
  name:"real_estate_prices",
  title:"House and apartment sale prices in Belgium (Statbel)",
  description:"What homes sell for in any of the 565 municipalities (2025 boundaries; Dutch, French or pre-merger names and NIS codes work), a province, a region or Belgium, from Statbel's official real-estate sales statistics (deeds of sale, 2010 to the latest full year plus the latest half-year). For houses (all, or terraced/semi-detached with 2-3 facades, or detached with 4+ facades) and apartments: the median price, the 25th and 75th percentile, the number of sales and the change of the median over five years. rank_by 'median_price' ranks municipalities within a province, region or Belgium, leaving out places with too few sales for a comparable median. Starts with key_facts; says when a figure rests on few sales. Prices are nominal sale prices of the homes that happened to be sold, not valuations of a specific home, and not rents.",
  inputSchema:{type:"object",properties:{
    places:{type:"array",items:{type:"string"},maxItems:6,description:"Up to 6 places to compare, e.g. ['Mechelen','Leuven'], ['Limburg','Flanders','Belgium'] or ['44088']. Default Belgium."},
    type:{type:"string",enum:["all","house","h23","h4","apartment"],description:"Default 'all' (houses and apartments). h23 = terraced or semi-detached houses, h4 = detached houses."},
    year:{type:"integer",description:"Sale year, 2010 to the latest full year; default the latest."},
    rank_by:{type:"string",enum:["median_price"],description:"Rank municipalities by median price of one type (default houses) instead of listing places."},
    within:{type:"string",description:"With rank_by: a province, region or 'Belgium' (default)."},
    order:{type:"string",enum:["highest","lowest"],description:"With rank_by; default highest."},
    limit:{type:"integer",minimum:1,maximum:25,description:"With rank_by; default 10."},
    min_sales:{type:"integer",minimum:1,maximum:500,description:"With rank_by: leave out municipalities with fewer sales than this, default 20."}
  }},
  source:{publisher:"Statbel, the Belgian statistical office",licence:"CC BY 4.0",url:"https://statbel.fgov.be/en/open-data/real-estate-sales-according-nature-property-deed-sale-belgium"},
  hosts:[],   // answers from public/statbel/immo-* (built by scripts/build-statbel-immo.mjs), no upstream request
  maxRequests:0,
  run:realEstatePrices,
  examples:[
    {args:{places:["Mechelen","Leuven"]},note:"What does a house or an apartment cost in Mechelen compared with Leuven?",replay:true},
    {args:{rank_by:"median_price",within:"Limburg",type:"house",limit:5},note:"Where in Limburg are houses most expensive?"},
    {args:{places:["Belgium"],type:"apartment",year:2020},note:"Median apartment price in Belgium in 2020"}
  ],
  routing:{words:/^(vastgoed\w*|huizenprijs\w*|woningprijs\w*|huisprijs\w*|koopprijs\w*|immobili\w*|immo|estate|maison|maisons|appartement|appartementen|appartements|apartment|apartments|woningprijzen)$/,
    hint:"For what homes sell for in a municipality, province or region, real_estate_prices answers with Statbel's median sale prices."}
});
