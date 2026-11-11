// Dutch / French / English concept groups for Belgian open-data search. Words in one group are treated as the same concept.
// Shared by the MCP search (OR within a group, AND across the query's groups) and the browser search. Words are lower-case, accent-free.
export const CONCEPTS=[
  ["municipality","gemeente","gemeenten","commune","communes","municipal","gemeentelijk","communal","stad","ville","city"],
  ["population","bevolking","inwoners","habitants","population","demografie","demographie","demography","census","volkstelling","recensement"],
  ["household","huishouden","huishoudens","menage","menages","gezin","family","families"],
  ["election","elections","verkiezing","verkiezingen","scrutin","vote","stemmen","uitslag","uitslagen"],
  ["parliament","parlement","kamer","chamber","senate","senaat"],
  ["crime","criminaliteit","criminalite","misdrijf","misdrijven","delit","police","politie","politiek","criminal","criminels","feiten"],
  ["accident","ongeval","ongevallen","accidents","verkeersongevallen","road safety","verkeersveiligheid"],
  ["traffic","verkeer","trafic","circulation","telling","tellingen","comptage","counts"],
  ["bicycle","bike","fiets","fietsen","velo","velos","cycling","cyclable","fietspad"],
  ["parking","parkeren","stationnement","parkings"],
  ["transport","vervoer","mobility","mobiliteit","mobilite","openbaar","public transport","transports"],
  ["train","trein","treinen","rail","spoor","sncb","nmbs","infrabel","station","gare","stations"],
  ["bus","tram","metro","stib","mivb","delijn","lijn","tec","gtfs","timetable","dienstregeling","horaire"],
  ["airport","luchthaven","aeroport","vlucht","flight","aviation"],
  ["unemployment","werkloosheid","chomage","werkzoekenden","jobseekers","demandeurs"],
  ["employment","werkgelegenheid","emploi","jobs","arbeid","travail","labour","labor","werk","work"],
  ["income","inkomen","inkomens","revenu","revenus","wages","loon","salaire","salaires","salary"],
  ["poverty","armoede","pauvrete","risk of poverty","deprivation"],
  ["housing","woning","woningen","logement","logements","wonen","habitat","dwelling","dwellings","huisvesting"],
  ["price","prijs","prijzen","prix","inflation","inflatie","cpi","consumptieprijzen"],
  ["tax","belasting","belastingen","impot","impots","fiscal","fiscaal","taxes","fiscalite"],
  ["budget","begroting","begrotingen","budgets","public finance","overheidsfinancien","finances"],
  ["enterprise","enterprises","company","companies","onderneming","ondernemingen","entreprise","entreprises","kbo","bce","crossroads","kruispuntbank","vkbo","ondernemingsnummer","business","businesses","bedrijf","bedrijven","firm","vat","btw","tva","numero"],
  ["bankruptcy","faillissement","faillissementen","faillite","faillites","insolvency"],
  ["address","adres","adressen","adresse","adresses","locatie","location"],
  ["map","kaart","kaarten","carte","cartes","maps","cartography","geodata","gis","geo","geografisch","geographic","geospatial"],
  ["boundary","boundaries","grenzen","grens","limites","limite","administrative","administratief","administratif"],
  ["parcel","perceel","percelen","parcelle","parcelles","cadastre","kadaster","cadastral","kadastraal"],
  ["building","gebouw","gebouwen","batiment","batiments","buildings","construction","bouw","bouwen"],
  ["land use","bodemgebruik","landgebruik","occupation du sol","landcover","land cover","bodembedekking"],
  ["agriculture","landbouw","agricole","agricultural","farm","farms","boer","boeren","gewas","gewassen","crop","crops","culture","cultures"],
  ["forest","bos","bossen","foret","forets","woodland","forestry","bosbouw"],
  ["nature","natuur","biodiversity","biodiversiteit","biodiversite","species","soorten","especes","fauna","flora","natura"],
  ["soil","bodem","sol","sols","pedology","bodemkaart"],
  ["geology","geologie","geologique","geological","ondergrond","subsurface","borehole","boringen","forages","sondage"],
  ["groundwater","grondwater","eaux souterraines","nappe","aquifer","aquifere","freatisch"],
  ["water","eau","eaux","waterkwaliteit","water quality","qualite eau","rivier","rivieren","river","rivers","riviere","rivieres","waterloop","waterlopen","cours deau"],
  ["flood","overstroming","overstromingen","inondation","inondations","flooding","hoogwater"],
  ["rain","regen","neerslag","precipitation","pluie","rainfall","pluviometrie"],
  ["weather","weer","meteo","temperature","temperatuur","climate","klimaat","climat","kmi","rmi","irm"],
  ["air","lucht","luchtkwaliteit","qualite air","air quality","pollution","vervuiling","uitstoot","emissions","emissies","emission","fijn stof","particulate","pm10","pm25","ozone","ozon"],
  ["noise","geluid","lawaai","bruit","geluidshinder","nuisance"],
  ["energy","energie","energies","electricity","elektriciteit","electricite","strom","gas","gaz","wind","fluvius","elia","consumption","verbruik","consommation"],
  ["waste","afval","dechets","recycling","recyclage","recyclage","huisvuil","containerpark","recyparc"],
  ["quality","kwaliteit","qualite"],
  ["solar","zonne","zonnepanelen","zonnepaneel","zonnestroom","photovoltaique","photovoltaic","photovoltaics","fotovoltaisch","pv","solaire"],
  ["panels","panelen","paneel","panneaux","panneau"],
  ["batteries","battery","batterij","batterijen","thuisbatterij","thuisbatterijen","thuisaccu","batterie","accu","accus","energieopslag","energieopslagsystemen"],
  ["storage","opslag","stockage","energieopslag","opslagsystemen"],
  ["home","thuis","domestic","residential","domicile","particulier","particuliers","huishoudelijk"],
  ["environment","milieu","environnement","environmental","ecologie","ecology"],
  ["health","gezondheid","sante","zorg","soins","care","healthcare","gezondheidszorg"],
  ["hospital","ziekenhuis","ziekenhuizen","hopital","hopitaux","hospitals"],
  ["vaccination","vaccinatie","vaccin","vaccins","vaccine","vaccines","covid","corona","coronavirus"],
  ["disease","ziekte","ziektes","maladie","maladies","cancer","kanker","diabetes","infection","infectie"],
  ["death","sterfte","mortalite","mortality","overlijden","deces","deaths","doodsoorzaken","causes"],
  ["birth","geboorte","geboortes","naissance","naissances","births","fertility","vruchtbaarheid","natalite"],
  ["school","scholen","ecole","ecoles","onderwijs","enseignement","education","educatie","schools","leerlingen","eleves","pupils","students","studenten"],
  ["university","universiteit","universite","hogeschool","hautes ecoles","higher education","hoger onderwijs"],
  ["childcare","kinderopvang","accueil","creche","creches","opvang","petite enfance"],
  ["culture","cultuur","musee","musea","museum","museums","erfgoed","patrimoine","heritage","bibliotheek","bibliotheque","library"],
  ["sport","sports","sportinfrastructuur","sportaccommodaties"],
  ["tourism","toerisme","tourisme","hotel","hotels","overnachtingen","nuitees","accommodation","logies"],
  ["migration","migratie","immigration","immigratie","asile","asiel","asylum","nationality","nationaliteit","nationalite","foreigners","vreemdelingen","etrangers"],
  ["language","taal","taalgebruik","langue","langues","languages"],
  ["age","leeftijd","age","ages","leeftijdsgroepen","groupes dage","senior","ouderen","elderly","youth","jongeren","jeunes"],
  ["gender","geslacht","sexe","sex","genre","women","vrouwen","femmes","men","mannen","hommes"],
  ["postcode","postal","postnummer","postcodes","code postal","codes postaux"],
  ["road","weg","wegen","route","routes","straat","straten","rue","rues","street","streets","road network","wegennet","reseau routier","wegenregister"],
  ["lighting","verlichting","eclairage","street lighting"],
  ["internet","broadband","breedband","large bande","telecom","telecommunicatie","mobile","gsm","coverage","dekking","couverture","bipt","bipt"],
  ["security","veiligheid","securite","fire","brandweer","pompiers","emergency","nood","urgence","112"],
  ["justice","justitie","tribunal","rechtbank","courts","hof","prison","gevangenis"],
  ["public procurement","overheidsopdrachten","marches publics","aanbestedingen","tenders","procurement"],
  ["subsidy","subsidie","subsidies","subvention","subventions","grants","toelage"],
  ["civil servants","ambtenaren","fonctionnaires","personeel","personnel","staff"],
  ["sea","zee","mer","noordzee","north sea","kust","coast","cote","maritime","marine","haven","port","havens","ports"],
  ["shipping","scheepvaart","navigation","vaart","vessel","schepen","navires","inland waterway","binnenvaart"],
  ["border","grens","frontiere","cross-border","grensarbeiders","frontaliers","commuting","pendel","pendelaars","navetteurs"]
];

const norm=s=>String(s??"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase();
const matchesMember=(member,t)=>member===t||(t.length>=5&&member.startsWith(t))||(member.length>=5&&t.startsWith(member));

/** Equivalent single words for one query word (the word itself first). Short words only match exactly. Multi-word members
 *  ("air quality", "risk of poverty") are skipped: split into words they would make "air" match water quality and "poverty" match "risk". */
export function expandWord(word,concepts=CONCEPTS){
  const t=norm(word).trim(),out=new Set([t]);
  if(!t)return[];
  for(const group of concepts){
    if(!group.some(m=>!m.includes(" ")&&matchesMember(m,t)))continue;
    for(const m of group)if(!m.includes(" ")&&m.length>=2)out.add(m);
  }
  return[...out].slice(0,24);
}
