// contact_publisher: a ready-to-send message to the people who publish a dataset, built from the catalogue record. Nothing is sent
// here: the answer holds the publisher's declared contact, a draft and a mailto: link, and the user sends it from their own mailbox.
// The recipient is only ever the address the publisher declared in its own catalogue record; callers cannot supply one.

export const ISSUES={
  stale:{en:"The data or its update date looks out of date",nl:"De gegevens of hun bijwerkingsdatum lijken verouderd",fr:"Les données ou leur date de mise à jour semblent dépassées",de:"Die Daten oder ihr Aktualisierungsdatum scheinen veraltet"},
  access:{en:"A download link or API does not work",nl:"Een downloadlink of API werkt niet",fr:"Un lien de téléchargement ou une API ne fonctionne pas",de:"Ein Download-Link oder eine API funktioniert nicht"},
  metadata:{en:"The description or metadata is missing or wrong",nl:"De beschrijving of metadata ontbreekt of klopt niet",fr:"La description ou les métadonnées manquent ou sont erronées",de:"Beschreibung oder Metadaten fehlen oder sind falsch"},
  units:{en:"Units or column meanings are not stated",nl:"Eenheden of de betekenis van kolommen worden niet vermeld",fr:"Les unités ou la signification des colonnes ne sont pas indiquées",de:"Einheiten oder Spaltenbedeutungen sind nicht angegeben"},
  values:{en:"Some values look wrong",nl:"Sommige waarden lijken niet te kloppen",fr:"Certaines valeurs semblent erronées",de:"Einige Werte scheinen falsch"},
  missing:{en:"Records, periods or areas are missing",nl:"Er ontbreken records, periodes of gebieden",fr:"Des enregistrements, périodes ou zones manquent",de:"Datensätze, Zeiträume oder Gebiete fehlen"},
  schema:{en:"The file structure changed without notice",nl:"De structuur van het bestand is zonder aankondiging gewijzigd",fr:"La structure du fichier a changé sans annonce",de:"Die Dateistruktur hat sich ohne Ankündigung geändert"},
  licence:{en:"The licence or reuse terms are unclear",nl:"De licentie of hergebruiksvoorwaarden zijn onduidelijk",fr:"La licence ou les conditions de réutilisation ne sont pas claires",de:"Lizenz oder Nutzungsbedingungen sind unklar"},
  question:{en:"A question about the data",nl:"Een vraag over de gegevens",fr:"Une question sur les données",de:"Eine Frage zu den Daten"}
};
export const ISSUE_IDS=Object.keys(ISSUES);
export const LANGS=["nl","fr","en","de"];

const T={
  en:{subject:"Open data feedback",hello:"Hello,",intro:"I use your open dataset and would like to report the following.",dataset:"Dataset",id:"Catalogue id",page:"Page",file:"File",issue:"Issue",details:"Details",evidence:"What I checked",ask:"Could you look into this, or tell me where to report it otherwise?",thanks:"Thank you for publishing this data.",regards:"Kind regards,",footer:"(Drafted with the help of Belgium Data Desk, data.vecture.be, and sent by me from my own mailbox.)"},
  nl:{subject:"Feedback over open data",hello:"Beste,",intro:"Ik gebruik jullie open dataset en wil het volgende melden.",dataset:"Dataset",id:"Catalogus-id",page:"Pagina",file:"Bestand",issue:"Melding",details:"Toelichting",evidence:"Wat ik nagekeken heb",ask:"Kunnen jullie dit bekijken, of laten weten waar ik dit anders kan melden?",thanks:"Bedankt om deze gegevens te publiceren.",regards:"Met vriendelijke groeten,",footer:"(Opgesteld met hulp van Belgium Data Desk, data.vecture.be, en door mij verstuurd vanuit mijn eigen mailbox.)"},
  fr:{subject:"Retour sur des données ouvertes",hello:"Bonjour,",intro:"J'utilise votre jeu de données ouvert et je souhaite signaler ce qui suit.",dataset:"Jeu de données",id:"Identifiant catalogue",page:"Page",file:"Fichier",issue:"Signalement",details:"Précisions",evidence:"Ce que j'ai vérifié",ask:"Pourriez-vous examiner ce point, ou m'indiquer où le signaler autrement ?",thanks:"Merci de publier ces données.",regards:"Cordialement,",footer:"(Rédigé avec l'aide de Belgium Data Desk, data.vecture.be, et envoyé par moi depuis ma propre boîte mail.)"},
  de:{subject:"Rückmeldung zu offenen Daten",hello:"Guten Tag,",intro:"Ich nutze Ihren offenen Datensatz und möchte Folgendes melden.",dataset:"Datensatz",id:"Katalog-ID",page:"Seite",file:"Datei",issue:"Meldung",details:"Details",evidence:"Was ich geprüft habe",ask:"Könnten Sie das prüfen oder mir sagen, wo ich es sonst melden kann?",thanks:"Danke, dass Sie diese Daten veröffentlichen.",regards:"Mit freundlichen Grüßen,",footer:"(Mit Hilfe von Belgium Data Desk, data.vecture.be, verfasst und von mir aus meinem eigenen Postfach gesendet.)"}
};

// What to check before writing, so a publisher is not asked about something the data already answers.
const CHECK_FIRST={
  stale:"Run preview_dataset first. If the file holds recent dates (its freshness block), the data is current and only the catalogue date is old: report 'metadata' instead, quoting the latest date in the file.",
  access:"Run preview_dataset first: it reads the file live from the publisher. If it works, the link is fine and the problem is elsewhere (a client, a proxy or a different file).",
  units:"Check the description in get_dataset and the landing page first: units are often stated there rather than in the file.",
  values:"Quote the exact rows and columns from preview_dataset; a value that looks wrong may be a code or use a comma decimal separator.",
  schema:"Compare preview_dataset's columns with the card's column changes in get_dataset before reporting.",
  metadata:"Name the field that is wrong or missing (for example the update date, the update cycle or the column list) and what the file shows instead.",
  missing:"Say which period, area or records you expected and where the expectation comes from.",
  licence:"Quote the licence label from get_dataset and say what reuse you have in mind.",
  question:"Check get_dataset's description and the landing page first; ask one concrete question."
};

const validEmail=s=>typeof s==="string"&&s.length<=254&&/^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s);
const oneLine=(s,max)=>String(s??"").replace(/[\r\n\t]+/g," ").replace(/\s{2,}/g," ").trim().slice(0,max);
const text=(s,max)=>String(s??"").replace(/\r\n?/g,"\n").replace(/[^\S\n]+/g," ").replace(/\n{3,}/g,"\n\n").trim().slice(0,max);

/** The publisher's language from the record: Flemish bodies in Dutch, Walloon ones in French, otherwise Dutch for .vlaanderen.be etc. */
export function languageFor(g){
  const geo=String(g?.geography||"").toLowerCase(),mail=String(g?.contact?.email||"").toLowerCase(),pub=String(g?.publisher||"").toLowerCase();
  if(/vlaanderen|flanders|flandre/.test(geo)||/\.vlaanderen\.be$|\.gent$|\.brugge\.be$|antwerpen\.be$/.test(mail)||/flemish|vlaams|vlaamse/.test(pub))return"nl";
  if(/wallon|wallonia|wallonie/.test(geo)||/wallonie\.be$|\.wallonie\.be$/.test(mail)||/walloon|wallon/.test(pub))return"fr";
  if(/ostbelgien|german-speaking|deutschsprachig/.test(geo+" "+pub))return"de";
  if(/brussels|bruxelles|brussel/.test(geo+" "+pub))return"fr";
  return"en";
}

/** A draft message (subject + plain-text body) for one dataset record (the get_dataset answer) and one issue. */
export function draftMessage(g,{issue,details="",evidence=[],language}){
  const lang=LANGS.includes(language)?language:languageFor(g),t=T[lang];
  const file=(g.files||[])[0]?.url||"";
  const ev=(Array.isArray(evidence)?evidence:[evidence]).map(e=>oneLine(e,300)).filter(Boolean).slice(0,5);
  const lines=[t.hello,"",t.intro,"",
    t.dataset+": "+oneLine(g.title,200),t.id+": "+g.id,...(g.landing_page?[t.page+": "+g.landing_page]:[]),...(file?[t.file+": "+file]:[]),
    t.issue+": "+ISSUES[issue][lang],
    ...(details?["",t.details+":",text(details,1500)]:[]),
    ...(ev.length?["",t.evidence+":",...ev.map(e=>"- "+e)]:[]),
    "",t.ask,t.thanks,"",t.regards,"","",t.footer];
  return{language:lang,subject:oneLine(t.subject+": "+ISSUES[issue][lang]+" – "+g.title,180),body:lines.join("\n")};
}

const MAILTO_MAX=1900;   // some mail clients drop longer mailto: links
export function mailtoLink(to,subject,body){
  const enc=encodeURIComponent;
  let b=body;
  for(;;){const href="mailto:"+to+"?subject="+enc(subject)+"&body="+enc(b);if(href.length<=MAILTO_MAX||b.length<200)return{href,shortened:b!==body};b=b.slice(0,Math.floor(b.length*0.8))+"\n[…]"}
}

/** The contact_publisher answer for a get_dataset record. */
export function contactPublisher(g,args={},origin=""){
  const issue=ISSUE_IDS.includes(args.issue)?args.issue:null;
  if(!issue)return{error:"issue must be one of: "+ISSUE_IDS.join(", ")+"."};
  if(args.details!=null&&typeof args.details!=="string")return{error:"details must be text."};
  const email=validEmail(g.contact?.email)?g.contact.email:null;
  const webUrl=g.contact?.url||g.landing_page||null;
  const draft=draftMessage(g,{issue,details:args.details||"",evidence:args.evidence||[],language:args.language});
  const base={id:g.id,title:g.title,publisher:g.publisher,check_first:CHECK_FIRST[issue]};
  if(!email)return{...base,contact:{email:null,web:webUrl,source:"The catalogue record declares no contact email."},channel:"web",
    draft,how_to_send:webUrl?"The publisher declares no email address. Use the contact or feedback options on "+webUrl+" and paste the draft there.":"The publisher declares no contact. The draft can be used once a contact is found on the publisher's own website.",
    sent:false,note:"Nothing was sent. No address is guessed or looked up elsewhere."};
  const link=mailtoLink(email,draft.subject,draft.body);
  return{...base,contact:{email,...(g.contact?.url?{web:g.contact.url}:{}),source:"Declared by the publisher in its catalogue record ("+(g.web_url||origin)+")."},channel:"email",
    draft,mailto:link.href,...(link.shortened?{mailto_note:"The link carries a shortened body (mail clients limit link length); paste the full draft if needed."}:{}),
    how_to_send:"Show the draft to the user. They send it themselves, from their own mailbox, after reading and editing it (the mailto link opens it in their mail app). Do not send it on their behalf.",
    sent:false,note:"Nothing was sent. One clear message per problem is enough; do not repeat it for each related dataset of the same publisher."};
}
