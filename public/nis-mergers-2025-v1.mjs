// The 1 January 2025 municipal mergers (decrees of the Flemish Government and the Walloon Government), as old NIS code -> 2025 NIS
// code. Checked against Statbel's 2024 and 2025 population files by scripts/build-statbel.mjs: every code that disappeared between the
// two files is listed, nothing else is, and each 2025 municipality equals the 2024 sum of its parts. Used there and by dataset cards
// (scripts/dataset-card.mjs) to tell whether a file uses pre-2025 municipality codes.
export const MERGERS_2025=Object.freeze({
  "11007":"11002",                                   // Borsbeek -> Antwerpen
  "11056":"46030","46003":"46030","46013":"46030",   // Zwijndrecht, Beveren, Kruibeke -> Beveren-Kruibeke-Zwijndrecht
  "23023":"23106","23024":"23106","23032":"23106",   // Galmaarden, Gooik, Herne -> Pajottegem
  "37012":"37021","37018":"37021",                   // Ruiselede, Wingene -> Wingene
  "37007":"37022","37015":"37022",                   // Meulebeke, Tielt -> Tielt
  "44012":"44086","44048":"44086",                   // De Pinte, Nazareth -> Nazareth-De Pinte
  "44034":"44087","44073":"44087",                   // Lochristi, Wachtebeke -> Lochristi
  "44040":"44088","44043":"44088",                   // Melle, Merelbeke -> Merelbeke-Melle
  "46014":"46029","44045":"46029",                   // Lokeren, Moerbeke -> Lokeren
  "71057":"71071","71069":"71071",                   // Tessenderlo, Ham -> Tessenderlo-Ham
  "71022":"71072","73040":"71072",                   // Hasselt, Kortessem -> Hasselt
  "73006":"73110","73032":"73110",                   // Bilzen, Hoeselt -> Bilzen-Hoeselt
  "73009":"73111","73083":"73111",                   // Borgloon, Tongeren -> Tongeren-Borgloon
  "82003":"82039","82005":"82039"                    // Bastenaken (Bastogne), Bertogne -> Bastenaken
});
