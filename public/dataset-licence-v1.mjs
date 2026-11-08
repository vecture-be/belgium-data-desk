// Licence interpretation shared by the harvest and the browser (single source of truth).
const clean=s=>String(s??"").replace(/\s+/g," ").trim();
/* ---------- licences ---------- */
// family: open | open-sharealike | non-commercial | no-derivatives | custom | unknown
export const LICENSE_RULES=[
  [/modellicentie[- ]gratis[- ]hergebruik/i,"flemish-free-reuse","Flemish free-reuse model licence v1.0","open"],
  [/(^|[/_ -])CC[_ -]?BY[_ -]?NC[_ -]?SA/i,"cc-by-nc-sa","CC BY-NC-SA","non-commercial"],
  [/(^|[/_ -])CC[_ -]?BY[_ -]?NC[_ -]?ND/i,"cc-by-nc-nd","CC BY-NC-ND","non-commercial"],
  [/(^|[/_ -])CC[_ -]?BY[_ -]?NC/i,"cc-by-nc","CC BY-NC","non-commercial"],
  [/(^|[/_ -])CC[_ -]?BY[_ -]?ND/i,"cc-by-nd","CC BY-ND","no-derivatives"],
  [/(^|[/_ -])CC[_ -]?BY[_ -]?SA/i,"cc-by-sa","CC BY-SA","open-sharealike"],
  [/(^|[/_ -])CC[_ -]?BY/i,"cc-by","CC BY","open"],
  [/(^|[/_ -])CC0/i,"cc0","CC0 (public domain)","open"],
  [/ODC[_ -]?PDDL/i,"odc-pddl","ODC PDDL (public domain)","open"],
  [/ODC[_ -]?BY/i,"odc-by","ODC-BY","open"],
  [/ODC[_ -]?ODBL|odbl/i,"odbl","ODbL","open-sharealike"],
  [/OGL[_ -]?3|open-government-licen[cs]e/i,"ogl-3","Open Government Licence 3.0","open"],
  [/(^|[/_-])(MIT|APACHE_?2|BSD)/i,"permissive-software","Permissive software licence","open"],
  [/(^|[/_-])(A?GPL|LGPL)/i,"gpl","GPL-family software licence","open-sharealike"],
  [/elia-open-data-license/i,"elia-open-data","Elia open data licence","custom"],
  [/licentieopendatafluvius/i,"fluvius-open-data","Fluvius open data licence","custom"],
  [/licence-urbis-open-data|urbis/i,"urbis-open-data","Urbis open data licence","custom"],
  [/infocenter\.belgium\.be.*copyright/i,"belgian-federal-copyright","Belgian federal copyright notice","custom"],
  [/geoportail\.wallonie\.be|DataSPW|LicServicesSPW/i,"spw-conditions","SPW Wallonia conditions of use","custom"],
  [/custom-kuleuven/i,"kuleuven-custom","KU Leuven custom licence","custom"]
];
export function normalizeLicense(raw){
  const value=clean(raw);if(!value)return{id:"",label:"",family:"unknown",raw:""};
  for(const [re,id,label,family] of LICENSE_RULES)if(re.test(value))return{id,label,family,raw:value};
  return{id:"other",label:value.length>60?value.slice(0,57)+"…":value,family:"custom",raw:value};
}
export const LICENSE_FAMILY_NOTE={
  open:"Reuse allowed, usually with attribution.",
  "open-sharealike":"Reuse allowed, derived work must keep the same licence.",
  "non-commercial":"Non-commercial reuse only — not an open licence.",
  "no-derivatives":"No modified versions allowed — not an open licence.",
  custom:"Publisher-specific terms — read them before reuse.",
  unknown:"No licence stated in the catalogue record."
};


/** Canonical licence texts, for structured data (schema.org wants a URL). Versions follow the EU vocabulary used by data.gov.be (CC 4.0). */
export const LICENSE_URLS={
  "flemish-free-reuse":"https://data.vlaanderen.be/id/licentie/modellicentie-gratis-hergebruik/v1.0",
  "cc-by":"https://creativecommons.org/licenses/by/4.0/","cc0":"https://creativecommons.org/publicdomain/zero/1.0/","cc-by-sa":"https://creativecommons.org/licenses/by-sa/4.0/",
  "cc-by-nc":"https://creativecommons.org/licenses/by-nc/4.0/","cc-by-nc-sa":"https://creativecommons.org/licenses/by-nc-sa/4.0/","cc-by-nc-nd":"https://creativecommons.org/licenses/by-nc-nd/4.0/","cc-by-nd":"https://creativecommons.org/licenses/by-nd/4.0/",
  "odc-by":"https://opendatacommons.org/licenses/by/1-0/","odc-pddl":"https://opendatacommons.org/licenses/pddl/1-0/","odbl":"https://opendatacommons.org/licenses/odbl/1-0/","ogl-3":"https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
};
