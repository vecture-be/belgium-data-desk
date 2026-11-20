// Cautious change labels for the existing weekly full-file changelog.
// Raw row, column and period comparisons remain authoritative; labels are not publisher releases.
const goodDate=s=>typeof s==='string'&&s.trim()&&Number.isFinite(Date.parse(s));

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
