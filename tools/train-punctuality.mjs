import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { TRAIN_HOSTS, trainPunctuality } from "../trains.mjs";

export default defineTool({
  name:"train_punctuality",
  title:"Belgian train punctuality: journey, station, train, IC line, national (Infrabel)",
  description:"How punctual Belgian trains are, from Infrabel's official open data. Between two stations (from_station and to_station, e.g. a commute): every direct train that stopped at both yesterday, how many arrived less than 6 minutes late, average and worst delays, scheduled against actual journey time, morning and evening peak, the return direction, and the two stations' monthly figures. For a station (name in Dutch, French or English, or the nearest one to an address): the share of trains arriving less than 6 minutes late in the latest month against the average over all stops, its rank, the last 13 months, yesterday train by train (delay bands, average delay, the latest trains) and major incidents there. For a train number: every point it passed yesterday with its delays, where the delay grew and whether it was on time at the official measuring points. For an IC line (e.g. 'IC 01'): monthly punctuality per direction and by time of day against the national figure. With none of these: the national figure (also counting cancellations), by train type, punctuality lost by cause, cancellations per operator, the month's major incidents (delay minutes, cancelled trains), and today so far. Starts with key_facts. Does not give live departures or platform changes, and has no train-by-train data before yesterday.",
  inputSchema:{type:"object",properties:{
    from_station:{type:"string",description:"With to_station: trains between two stations yesterday, e.g. 'Leuven'."},
    to_station:{type:"string",description:"With from_station: where the trains arrive, e.g. 'Brussel-Centraal', 'Bruxelles-Central'."},
    station:{type:"string",description:"A passenger station, e.g. 'Leuven', 'Bruxelles-Midi', 'Gent-Sint-Pieters', 'Luik-Guillemins'."},
    address:{type:"string",description:"An address or place instead of a station: the nearest station is used, e.g. 'Grote Markt 1, 2800 Mechelen'."},
    ...COORDINATE_PROPERTIES,
    train_number:{type:"string",description:"A train number as on the departure board, e.g. '2112': its run yesterday stop by stop."},
    ic_line:{type:"string",description:"An InterCity line, e.g. 'IC 01', 'IC 16-1' or 'IC3'."},
    month:{type:"string",description:"Month for the monthly figures as YYYY-MM, e.g. '2026-03'; default the latest Infrabel published."}
  }},
  source:{publisher:"Infrabel (Belgian rail infrastructure manager)",licence:"CC0 1.0",url:"https://opendata.infrabel.be"},
  hosts:[...TRAIN_HOSTS,...GEOCODER_HOSTS],
  maxRequests:12,
  run:trainPunctuality,
  examples:[
    {args:{from_station:"Leuven",to_station:"Brussel-Centraal"},note:"How punctual is the commute from Leuven to Brussels-Central?"},
    {args:{station:"Leuven"},note:"How punctual are trains at Leuven station?",replay:true},
    {args:{train_number:"2112"},note:"Was train 2112 late yesterday, and where did it lose time?"},
    {args:{ic_line:"IC 01"},note:"How punctual is the IC 01 Oostende-Eupen?"},
    {args:{},note:"How punctual were Belgian trains last month, and today?"}
  ],
  routing:{words:/^(stiptheid|punctuality|ponctualite|ponctualité|vertraging|vertragingen|delay|delays|retard|retards|trein|treinen|train|trains|nmbs|sncb|infrabel|spoor|pendel|pendelen|woonwerk|commute|commuting|navette|navetteur)$/,
    hint:"For how punctual trains are between two stations, at a station, on a line, for one train yesterday or nationally, train_punctuality answers from Infrabel's official figures."}
});
