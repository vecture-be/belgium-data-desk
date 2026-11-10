import { COORDINATE_PROPERTIES, GEOCODER_HOSTS, defineTool } from "../lib/tool-contract.mjs";
import { SEARCH_LIMIT, SEARCH_RADIUS, TYPES, searchSubsurface } from "../dov-search.mjs";

export default defineTool({
  name:"search_subsurface",
  title:"Find boreholes, wells, CPTs, soil profiles or groundwater permits in Flanders",
  description:"Find DOV records by area and attributes, e.g. the deepest boreholes in a municipality, geothermal boreholes since 2020, groundwater wells in the Brussel sand with quality data, electric CPTs near an address, soil profiles with lab data, or the largest groundwater abstraction permits in a municipality (with the licensed total per aquifer). Area: a municipality (official 2025 boundary; old pre-merger names work), or an address/coordinates with radius_m, or nothing for all of Flanders. Filtering and sorting run on DOV's server, so counts cover every matching record. Use get_subsurface_record with a result id for details.",
  inputSchema:{type:"object",properties:{
    record_type:{type:"string",enum:Object.keys(TYPES),description:"What to find."},
    municipality:{type:"string",description:"Municipality in Flanders, e.g. 'Leuven' or 'Merelbeke-Melle'."},
    address:{type:"string",description:"Address in Flanders, as an alternative to municipality (then radius_m applies)."},
    ...COORDINATE_PROPERTIES,
    radius_m:{type:"integer",minimum:SEARCH_RADIUS.min,maximum:SEARCH_RADIUS.max,description:"Radius around the address or coordinates, default "+SEARCH_RADIUS.default+" m."},
    min_depth_m:{type:"number",description:"Minimum depth (borehole or CPT depth, well screen bottom, permitted well depth)."},
    max_depth_m:{type:"number",description:"Maximum depth, same fields."},
    date_from:{type:"string",description:"YYYY, YYYY-MM or YYYY-MM-DD: drilling/test date, last water-level date for wells, permit start, survey date."},
    date_to:{type:"string",description:"Same formats as date_from."},
    purpose:{type:"string",enum:["geological","geotechnical","groundwater_abstraction","dewatering","hydrogeological","geothermal","groundwater_monitoring","energy_exploration","contaminated_site_monitoring"],description:"Boreholes: why it was drilled."},
    with_stratigraphy:{type:"boolean",description:"Boreholes: only those with a formal, hydrogeological or Quaternary stratigraphy."},
    cpt_method:{type:"string",enum:["electric","mechanical"],description:"CPTs: electric CPTs also measure sleeve friction."},
    aquifer:{type:"string",description:"Wells and permits: HCOV code (A0620, or A06 for the whole system) or words from the unit name ('Brussel', 'Krijt')."},
    with_quality_data:{type:"boolean",description:"Wells: only screens with groundwater quality samples."},
    with_lab_data:{type:"boolean",description:"Soil profiles: only those with lab samples."},
    min_annual_m3:{type:"number",description:"Permits: minimum licensed annual volume in m³."},
    sort:{type:"string",enum:["nearest","deepest","newest","oldest","largest","most_described"],description:"Default: nearest with a location; otherwise deepest (boreholes, CPTs), newest (wells), largest (permits), most_described (soil profiles)."},
    limit:{type:"integer",minimum:1,maximum:SEARCH_LIMIT.max,description:"Results to list, default "+SEARCH_LIMIT.default+"."}
  },required:["record_type"]},
  source:{publisher:"Databank Ondergrond Vlaanderen (DOV), Flemish Government",licence:"Modellicentie Gratis Hergebruik",url:"https://www.dov.vlaanderen.be"},
  hosts:["www.dov.vlaanderen.be",...GEOCODER_HOSTS],
  maxRequests:20,
  run:searchSubsurface,
  examples:[
    {args:{record_type:"boreholes",municipality:"Leuven",limit:3},note:"The deepest boreholes in Leuven",replay:true},
    {args:{record_type:"boreholes",purpose:"geothermal",date_from:"2020",limit:5},note:"Geothermal boreholes drilled in Flanders since 2020"},
    {args:{record_type:"groundwater_permits",municipality:"Gent",sort:"largest",limit:5},note:"The largest groundwater abstraction permits in Ghent"}
  ]
});
