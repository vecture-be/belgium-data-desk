import { defineTool } from "../lib/tool-contract.mjs";
import { DECISION_HOSTS, localDecisions } from "../decisions.mjs";

export default defineTool({
  name:"local_decisions",
  title:"Flemish local council decisions (Lokaal Beslist)",
  description:"What a Flemish municipality decided or has on its agenda, from Lokaal Beslist, the Flemish Government's collection of the agenda items and decisions that local authorities must publish as linked open data. With municipality: its agenda items newest meeting first, from the municipal council, college of mayor and aldermen, mayor, OCMW council, standing bureau and social committee, including the bodies of every legislature and of municipalities merged into it in 2019 or 2025, optionally narrowed by query (words in the title, e.g. 'verkeersdrempel', a street name), body (council, college, social) and a from/to date; also the date of the latest meeting the municipality has published, so a gap is not read as 'nothing decided'. Without municipality, query searches title and description across every authority in Flanders. With agenda_item_id (from an earlier answer): the decision text, motivation, articles and published vote counts, with the link to the municipality's own official publication. Titles and texts are in Dutch: search with Dutch words. Covers Flanders only (not Brussels or Wallonia); municipalities publish with a delay of days to months, and coverage before 2019 varies per municipality. Does not give personal data of citizens, council members' individual votes, or permit applications that were never on an agenda.",
  inputSchema:{type:"object",properties:{
    municipality:{type:"string",description:"A Flemish municipality, Dutch name preferred, e.g. 'Leuven', 'Gent', 'Merelbeke-Melle' (French or English names such as 'Louvain' or 'Ghent' also work)."},
    query:{type:"string",description:"Dutch words to find, e.g. 'verkeersdrempel', 'zonnepanelen', 'Kerkstraat', 'speelplein'. Use a word stem ('fiets') to catch compounds ('fietspad', 'fietsstraat')."},
    body:{type:"string",enum:["all","council","college","social"],description:"Which bodies: 'council' (gemeenteraad, OCMW council), 'college' (college of mayor and aldermen, standing bureau, mayor), 'social' (social services committee) or 'all' (default)."},
    from:{type:"string",description:"Only meetings on or after this date, YYYY-MM-DD, e.g. '2025-01-01'."},
    to:{type:"string",description:"Only meetings on or before this date, YYYY-MM-DD, e.g. '2025-12-31'."},
    agenda_item_id:{type:"string",description:"The id of one agenda item from an earlier answer, for its decision text, articles and votes, e.g. '85385bd7-55a4-582a-a2af-7d1928cdeeca'."},
    limit:{type:"integer",minimum:1,maximum:25,description:"How many agenda items to list, 1-25 (default 10)."}
  }},
  source:{publisher:"Agentschap Binnenlands Bestuur (Flemish Government), Lokaal Beslist",licence:"Official acts of public authorities (no copyright, Code of Economic Law art. XI.172 §2), published under the Decreet over het Lokaal Bestuur",url:"https://lokaalbeslist.vlaanderen.be"},
  hosts:[...DECISION_HOSTS],
  maxRequests:6,
  run:localDecisions,
  examples:[
    {args:{municipality:"Leuven",query:"fiets",from:"2026-01-01"},note:"What did Leuven decide about cycling this year?",replay:true},
    {args:{municipality:"Aarschot",body:"council",limit:5},note:"What was on Aarschot's latest municipal council agenda?"},
    {args:{query:"verkeersdrempel",from:"2026-01-01"},note:"Which Flemish municipalities decided on speed bumps this year?"},
    {args:{agenda_item_id:"85385bd7-55a4-582a-a2af-7d1928cdeeca"},note:"What exactly was decided on this agenda item, and how did they vote?"}
  ],
  routing:{words:/^(gemeenteraad|gemeenteraadsbesluit|gemeenteraadsbesluiten|besluit|besluiten|agendapunt|agendapunten|schepencollege|schepenen|collegebesluit|raadsbesluit|ocmw-raad|gemeentebestuur|lokaalbeslist|lblod|conseil-communal|council|decision|decisions)$/,
    hint:"For what a Flemish municipality decided or has on its agenda (council, college, OCMW), local_decisions answers from Lokaal Beslist, the official collection of local decisions."}
});
