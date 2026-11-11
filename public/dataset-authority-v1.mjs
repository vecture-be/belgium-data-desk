// Authoritative sources for common Belgian data needs: which hand-reviewed record a Belgian data professional would point to first, and why.
// Search pins these above keyword matches when every "when" group is matched by a different query word. Words are lower-case and
// accent-free; a query word matches a listed word exactly or, from 5 letters, as a prefix either way ("ongeval" ~ "ongevallen").
// Keep entries factual and about the source (who publishes it, what it is the reference for); caveats name the traps people fall into.
// Every id must exist among the curated atlas assets (scripts/test-mcp.mjs checks this against the built index).

export const AUTHORITY_VERSION="1";

export const AUTHORITIES=[
  {
    need:"population counts",
    when:[["population","bevolking","inwoners","habitants","inhabitants","residents","demografie","demographie","demography"]],
    ids:["curated:statbel-pop-residence-2026","curated:statbel-pop-sector-2025-new","curated:statbel-refnis-2025"],
    why:"Statbel, the Belgian statistical office, publishes the official population on 1 January from the National Register, by municipality and statistical sector.",
    caveat:"Several municipalities merged on 1 January 2025; join on REFNIS (NIS) codes from the code table rather than on names, and check which boundary year a file uses."
  },
  {
    need:"enterprise register (enterprise numbers)",
    when:[["enterprise","enterprises","company","companies","onderneming","ondernemingen","entreprise","entreprises","kbo","bce","crossroads","kruispuntbank","ondernemingsnummer","vkbo","vat","btw","tva","btwnummer"]],
    unless:["account","accounts","jaarrekening","jaarrekeningen","balance","bilan","comptes","survival","survivals","statistics","statistiek","statistieken","statistiques","declarations","aangiften"],
    ids:["curated:kbo-open-full-active","curated:kbo-open-delta","curated:vkbo-ogc"],
    why:"The Crossroads Bank for Enterprises (KBO/BCE), kept by FPS Economy, is the legal register of every enterprise number; its open-data file is the full extract of active entities, with daily change files.",
    caveat:"A Belgian VAT number is BE followed by the 10-digit enterprise number, so the KBO answers VAT-number questions too. The open-data download requires a free registration with FPS Economy; VKBO is Digitaal Vlaanderen's enriched copy."
  },
  {
    need:"company annual accounts",
    when:[["account","accounts","jaarrekening","jaarrekeningen","balance","bilan","comptes","financial statements"]],
    ids:["curated:nbb-auth-refs","curated:nbb-auth-doc","curated:nbbstat-aa-sector"],
    why:"Companies file their annual accounts with the Central Balance Sheet Office of the National Bank of Belgium, which publishes the filings and sector statistics.",
    caveat:"Small companies file abbreviated or micro models, so many line items are absent rather than zero."
  },
  {
    need:"air quality measurements",
    when:[["air","lucht","luchtkwaliteit","pm10","pm25","ozone","ozon","no2","fijnstof","pollution","vervuiling"]],
    ids:["curated:ircel-pm10-station","curated:ircel-rio-commune","curated:ircel-atmostreet"],
    why:"IRCEL-CELINE, the interregional environment cell of the three regions, publishes Belgium's official air-quality measurements and models.",
    caveat:"Station values are point measurements; RIO and ATMO-Street are interpolated or modelled values, not measurements."
  },
  {
    need:"train punctuality",
    when:[["punctuality","stiptheid","ponctualite","delay","delays","vertraging","vertragingen","retard","retards"]],
    ids:["curated:infrabel-punct-monthly","curated:infrabel-punct-raw","curated:infrabel-punct-stop"],
    why:"Infrabel, the rail infrastructure manager, publishes the official punctuality figures and the raw per-train data behind them.",
    caveat:"A train counts as on time with less than 6 minutes' delay; cancelled trains are not in the punctuality percentage."
  },
  {
    need:"public transport timetables",
    when:[["gtfs","timetable","timetables","dienstregeling","horaire","horaires","schedule"]],
    ids:["curated:sncb-gtfs-static","curated:delijn-gtfs-static","curated:tec-gtfs-static"],
    why:"Operators publish their timetables as GTFS through the Belgian National Access Point for transport data (transportdata.be).",
    caveat:"Each operator (SNCB, De Lijn, TEC, STIB-MIVB) has its own feed; combine them yourself for door-to-door coverage."
  },
  {
    need:"weather observations",
    when:[["weather","weer","meteo","temperature","temperatuur","neerslag","precipitation","rainfall","regen","pluie"]],
    ids:["curated:rmi-aws","curated:rmi-synop","curated:rmi-radar-rain"],
    why:"The Royal Meteorological Institute (RMI/KMI/IRM) is the national weather service and publishes station observations and radar rainfall.",
    caveat:null
  },
  {
    need:"crime statistics",
    when:[["crime","crimes","criminaliteit","criminalite","misdrijf","misdrijven","offence","offences","delits"]],
    ids:["curated:federal-police-recorded-crime"],
    why:"The Federal Police publishes the official police crime statistics: criminal facts recorded by the police.",
    caveat:"Recorded facts measure what was reported and registered, not the true level of crime; changes in reporting or police priorities move the numbers."
  },
  {
    need:"road traffic accidents",
    when:[["accident","accidents","ongeval","ongevallen","verkeersongevallen","verkeersdoden","verkeersslachtoffers","collision","collisions","fatalities","casualties"]],
    ids:["curated:statbel-road-accidents-2025","curated:statbel-accidents-geolocated-2017-2024"],
    why:"Statbel compiles the official road-accident statistics from police accident reports.",
    caveat:"Only accidents with casualties that the police recorded are included; damage-only accidents are not."
  },
  {
    need:"unemployment",
    when:[["unemployment","unemployed","werkloosheid","werklozen","chomage","chomeurs","werkzoekenden","jobseekers"]],
    ids:["curated:onem-unemployment-municipality"],
    why:"RVA/ONEM, the national employment office, publishes monthly counts of people receiving unemployment benefits, down to municipality.",
    caveat:"Benefit recipients are not the ILO unemployment rate (Statbel's Labour Force Survey) and not registered jobseekers (VDAB, Le Forem, Actiris, ADG); the three measures differ."
  },
  {
    need:"election results",
    when:[["election","elections","verkiezing","verkiezingen","verkiezingsuitslag","verkiezingsuitslagen","uitslag","uitslagen","scrutin","elections"]],
    ids:["curated:elections-2024-municipality-results","curated:ibz-election-list-results","curated:ibz-election-candidate-results"],
    why:"FPS Interior's elections directorate publishes the official results of federal, regional and European elections.",
    caveat:"Local (municipal and provincial) elections are organised by the regions, which publish those results themselves."
  },
  {
    need:"municipality codes and boundaries",
    when:[["refnis","nis","niscode","ins","boundaries","boundary","grenzen","limites","sector","sectors","sectoren","secteurs","territorial"]],
    ids:["curated:statbel-refnis-2025","curated:statbel-sector-geom-2026","curated:ngi-territorial-divisions"],
    why:"Statbel maintains the REFNIS (NIS/INS) codes and statistical sectors; the National Geographic Institute publishes the official administrative boundaries.",
    caveat:"Municipal mergers on 1 January 2025 changed codes and boundaries; data published before then uses the old codes."
  },
  {
    need:"addresses",
    when:[["address","addresses","adres","adressen","adresse","adresses","addressregister","adresregister"]],
    ids:["curated:basis-address-v2","curated:grb-adres"],
    why:"Digitaal Vlaanderen publishes the official Flemish address register (part of the Belgian BeST address standard).",
    caveat:"This pinned register covers Flanders; Brussels (UrbIS) and Wallonia publish their own address registers — search with the region name."
  },
  {
    need:"cadastral parcels",
    when:[["cadastral","cadastre","kadaster","kadastraal","kadastrale","parcel","parcels","perceel","percelen","parcelle","parcelles"]],
    unless:["landbouw","agricultural","agriculture","agricole","crop","crops","teelt","landbouwgebruikspercelen"],
    ids:["curated:finance-cadastral-current","curated:finance-cadastral-fiscal","curated:adpf-current"],
    why:"FPS Finance (General Administration of Patrimonial Documentation) publishes the national land-register (cadastral) plan.",
    caveat:"The cadastral plan is fiscal, not a legal boundary survey; owners are not in the open data."
  },
  {
    need:"agricultural parcels",
    when:[["landbouw","agricultural","agriculture","agricole","crop","crops","teelt","landbouwgebruikspercelen","parcellaire"]],
    ids:["curated:agri-flanders-2026-s1","curated:agri-wallonia-all-years"],
    why:"The regional paying agencies publish the parcels farmers declare each year: the Flemish agriculture department and the Walloon public service.",
    caveat:"Declarations are made per region; Brussels has almost no agricultural parcels."
  },
  {
    need:"electricity grid load and generation",
    when:[["grid","generation","load","transmission","hoogspanning","productie","production"],["electricity","elektriciteit","electricite","power","stroom","elia"]],
    ids:["curated:elia-ods001","curated:elia-ods201"],
    why:"Elia, the Belgian high-voltage transmission system operator, publishes the national load and generation by fuel type.",
    caveat:null
  },
  {
    need:"energy consumption",
    when:[["consumption","verbruik","consommation","usage"],["energy","energie","electricity","elektriciteit","electricite","gas","gaz"]],
    ids:["curated:fluvius-consumption-sector-nace","curated:fluvius-consumption-street"],
    why:"Fluvius, the Flemish distribution system operator, publishes measured electricity and gas consumption by statistical sector and street.",
    caveat:"Fluvius covers Flanders; Wallonia (ORES, RESA) and Brussels (Sibelga) are served by other distribution operators."
  },
  {
    need:"home batteries and energy storage",
    when:[["battery","batteries","batterij","batterijen","thuisbatterij","thuisbatterijen","thuisaccu","accu","batterie","energieopslag","energieopslagsystemen"]],
    unless:["used","collection","collect","collecte","inzameling","inzamelpunt","recycling","recyclage","bebat","afval","waste","piles"],
    ids:["curated:fluvius-storage-systems"],
    why:"Fluvius publishes the energy storage systems, including home batteries, connected to its distribution grid in Flanders.",
    caveat:"Flanders only (the Fluvius grid). Collection points for used batteries (Bebat) are a different subject."
  },
  {
    need:"solar power",
    when:[["solar","zonne","zonnepanelen","zonnepaneel","zonnestroom","photovoltaic","photovoltaique","fotovoltaisch","pv","solaire"]],
    ids:["curated:elia-ods087","curated:fluvius-local-production-municipality"],
    why:"Elia publishes national photovoltaic production estimates; Fluvius publishes the local production installations connected in each Flemish municipality.",
    caveat:"Elia's figures are estimates from monitored installations, upscaled to the national total."
  },
  {
    need:"consumer prices and inflation",
    when:[["inflation","inflatie","cpi","consumptieprijzen","consumptieprijsindex","gezondheidsindex","indexation","indexering"]],
    ids:["curated:statbel-cpi-health"],
    why:"Statbel calculates the official consumer price index and the health index used for wage and rent indexation.",
    caveat:null
  },
  {
    need:"childcare",
    when:[["childcare","kinderopvang","creche","creches","opvang","daycare"]],
    ids:["curated:opgroeien-childcare-capacity-2026","curated:opgroeien-childcare-coverage-2026"],
    why:"Agentschap Opgroeien licenses childcare in Flanders and publishes capacity and coverage per municipality.",
    caveat:"Covers Flanders and Dutch-speaking Brussels; ONE publishes for French-speaking Wallonia and Brussels."
  },
  {
    need:"bicycle counts",
    when:[["bike","bikes","bicycle","bicycles","fiets","fietsen","velo","velos","cycling","cyclists"],["count","counts","counter","counters","telling","tellingen","comptage","comptages"]],
    ids:["curated:awv-bike-counts-monthly","curated:brussels-bike-counts"],
    why:"The Flemish roads agency (AWV) and Brussels Mobility run the permanent automatic bicycle counters.",
    caveat:null
  }
];

const norm=s=>String(s??"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase();
const close=(a,b)=>a===b||(a.length>=5&&b.length>=5&&(a.startsWith(b)||b.startsWith(a)));

/** Authorities whose every "when" group is matched by a different query word (and no "unless" word appears). Best first. */
export function authoritiesFor(queryWords,{max=1}={}){
  const words=[...new Set(queryWords.map(norm).filter(w=>w.length>=2))];
  const out=[];
  for(const a of AUTHORITIES){
    if((a.unless||[]).some(u=>words.some(w=>close(w,u))))continue;
    const used=new Set();let ok=true;
    for(const group of a.when){
      const w=words.find(x=>!used.has(x)&&group.some(g=>!g.includes(" ")&&close(x,g)));
      if(!w){ok=false;break}
      used.add(w);
    }
    if(ok)out.push({a,specificity:a.when.length});
  }
  return out.sort((x,y)=>y.specificity-x.specificity).slice(0,max).map(x=>x.a);
}
