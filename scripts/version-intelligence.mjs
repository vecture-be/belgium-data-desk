// Conservative dataset-version and lineage evidence, derived entirely from existing weekly checks.
// Never infer a publisher release, revision or semantic correction from a file timestamp or hash.
const clean=s=>typeof s==='string'&&s.trim()?s.trim():null;
const day=s=>clean(s)?.slice(0,10)||null;
const goodDate=s=>clean(s)&&Number.isFinite(Date.parse(s));
const safeUrl=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.toString():null}catch{return null}};
const safeCount=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const SEVERITY={blocking:3,review:2,informational:1,none:0};

/** Classify THIS successful observation, not a previously retained last_change_seen. */
export function classifyVersionChange(check){
  if(!check?.profile?.rows_exact)return {kind:'not_observed',severity:'none',basis:'No complete successful profile was available.'};
  const c=check.change,now=check.checkedAt;
  const recent=!!(c?.seen_at&&goodDate(c.seen_at)&&goodDate(now)&&Date.parse(c.seen_at)>=Date.parse(now)-1000);
  if(!recent){
    if(check.unchanged===true)return {
      kind:check.row_order_unstable?'no_semantic_change':'unchanged',severity:'none',
      basis:check.row_order_unstable?'Content fingerprint unchanged; row-order instability was observed (possibly earlier).':'Content fingerprint unchanged since the comparable observation.'};
    return {kind:'unassessed',severity:'none',basis:'No verified change this observation; a comparable earlier observation may be missing.'};
  }
  const a=c.alerts||[],added=c.distinct_rows_added,removed=c.distinct_rows_removed;
  const colsRemoved=c.columns_removed||[],colsAdded=c.columns_added||[],period=c.coverage||[];
  if(a.includes('emptied')||a.includes('rows_dropped')||a.includes('columns_removed')||a.includes('coverage_shrank')||colsRemoved.length)
    return {kind:'potential_breaking_change',severity:'review',basis:'Observed structural or coverage regression; publisher intent is unknown.',signals:[...a,...colsRemoved.map(x=>'removed:'+x)]};
  if(colsAdded.length)
    return {kind:'schema_evolution',severity:'review',basis:'Observed column-list change; downstream compatibility requires checking.',signals:colsAdded.map(x=>'added:'+x)};
  // Append-only requires both COMPLETE distinct-row baselines. Null means unknown, not zero.
  if(added!=null&&removed===0&&added>0){
    const grows=period.some(x=>x.before?.[1]!=null&&x.after?.[1]!=null&&x.after[1]>x.before[1]);
    return {kind:grows?'append_with_period_extension':'append_only_observed',severity:'informational',basis:'The observed distinct-row set contains every previous row; this does not establish a publisher release.'};
  }
  if(removed!=null&&removed>0)
    return {kind:'rows_replaced_or_removed',severity:'review',basis:'Previously observed distinct rows disappeared: possibly a revision, rolling window, or correction.'};
  return {kind:'content_change_unresolved',severity:'review',basis:'Content changed but its meaning cannot be established from the available evidence.'};
}

/** Edges we actually own; no fictitious dependence of live publisher tools on a harvested CSV. */
export function dependencyImpact(record,check){
  const id=clean(record?.id)||clean(check?.ds)||null;
  if(!id)return {nodes:[],edges:[],affected_outputs:[],confidence:'unknown'};
  const source='source:'+id,profile='profile:'+id,card='card:'+id,mcp='mcp:get_dataset:'+id,web='web:dataset:'+id;
  const doc='mcp:search_document:'+id,search='mcp:search_datasets:'+id;
  const facets='mcp:search_facets',summary='cards:summary',overview='mcp:catalogue_overview';
  return {
    nodes:[{id:source,role:'publisher_distribution',url:safeUrl(check?.url)},
      {id:profile,role:'weekly_observation'},{id:card,role:'static_dataset_card'},
      {id:mcp,role:'mcp_read_model'},{id:web,role:'web_dataset_page'},
      {id:doc,role:'derived_search_document'},{id:search,role:'search_result_projection'},
      {id:facets,role:'derived_year_and_language_filters'},
      {id:summary,role:'catalogue_card_summary'},{id:overview,role:'catalogue_overview'}],
    // backfillDocs() derives latest data, disagreements and measured period from the
    // card; summary counts are reported in catalogue_overview(). No dependence of
    // independent live answer tools on the harvested CSV is asserted.
    edges:[[source,profile],[profile,card],[card,mcp],[card,web],
      [card,doc],[doc,search],[doc,facets],[card,summary],[summary,overview]],
    affected_outputs:[card,mcp,web,doc,search,facets,summary,overview],
    confidence:'declared_pipeline_only',
    boundary:'These edges describe potential internal recalculation, not proof that other live tools, external analyses, or every search query depend on this file.'
  };
}

/** Revision, release, granularity, manifestation, provenance and citation have distinct meanings. */
export function versionPassport(record,check){
  if(!record?.id||!check?.profile)return null;
  const file=!!check.profile.rows_exact;
  return {schema_version:1,dataset_id:record.id,publisher:clean(record.publisher),
    identity:{dataset_id:record.id,distribution_url:safeUrl(check.url)},
    publisher_revision:null,publisher_release:null,
    catalogue:{updated_at:day(record.updatedAt),meaning:'Publisher catalogue metadata date, not a data release date.'},
    observation:{checked_at:goodDate(check.checkedAt)?check.checkedAt:null,
      extent:file?'whole_file':'first_bytes',rows_examined:safeCount(check.profile.rows),
      ...(check.profile.grain?.columns?.length?{observed_granularity:{key_columns:check.profile.grain.columns,rows_tested:check.profile.grain.rows_tested,source:'inferred_from_rows'}}:{})},
    manifestation:{content_sha256_prefix:file?clean(check.sha256):null,
      order_independent_row_set:file?clean(check.profile.row_set):null,
      schema_fingerprint:clean(check.profile.fingerprint),
      note:file?'Observation fingerprints; not publisher-issued version numbers or a guarantee of integrity.':'Only a bounded sample was profiled; complete-file identity is unknown.'},
    ...(check.content_since?{first_seen_current_content_at:check.content_since}:{}),
    ...(check.observed_since?{first_observed_at:check.observed_since}:{}),
    ...(check.change?.seen_at?{last_content_change_observed_at:check.change.seen_at}:{}),
    change_classification:classifyVersionChange(check),
    citation:{publisher:clean(record.publisher),dataset_title:clean(record.title),
      publisher_record_url:safeUrl(record.landingPage),distribution_url:safeUrl(check.url),
      observed_at:day(check.checkedAt),verified_full_content:file,
      caveat:'Cite the original publisher; this is a recorded manifestation, not necessarily an archival release.'}
  };
}

/** Publisher abnormalities warrant review, not blocking the entire catalogue. */
export function changeDecision(check,record){
  const change=classifyVersionChange(check),graph=dependencyImpact(record,check);
  return {classification:change.kind,severity:change.severity,
    action:change.severity==='review'?'review_affected_outputs':change.severity==='informational'?'record_change':'none',
    automatic_release_block:false,affected_outputs:graph.affected_outputs,
    explanation:'Publisher changes are observations, not proof of faults in Belgium Data Desk. Own-output invariant failures still block deployment.'};
}

/** Blocking CI assertions on our own claims and artefacts. */
export function validatePassport(passport,record,check){
  const errors=[];
  if(!passport||passport.dataset_id!==record?.id)errors.push('dataset_identity');
  if(passport?.publisher_revision!==null||passport?.publisher_release!==null)errors.push('publisher_release_invented');
  if(passport?.observation?.extent!==(check?.profile?.rows_exact?'whole_file':'first_bytes'))errors.push('observation_extent');
  if(passport?.manifestation?.order_independent_row_set!==(check?.profile?.rows_exact?clean(check.profile.row_set):null))errors.push('row_set_mismatch');
  if(passport?.manifestation?.content_sha256_prefix!==(check?.profile?.rows_exact?clean(check.sha256):null))errors.push('content_hash_mismatch');
  if(!Object.hasOwn(SEVERITY,passport?.change_classification?.severity))errors.push('change_severity');
  return errors;
}
