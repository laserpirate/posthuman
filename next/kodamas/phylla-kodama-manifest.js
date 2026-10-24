/* ===========================================================================
   phylla-kodama-manifest.js  —  SINGLE SOURCE OF TRUTH for per-study text.
   v2 edit: she-register retired from delta-arc subtitles (19/21/22/24). Edit a title / subtitle / scientific-ecology name / soundtrack HERE, once.
   The gallery AND every scene read from this file, so nothing is baked in.
     title : display title (Cambria italic)      sub   : the phylla-kodama study line
     sci   : traditional/scientific ecology name  audio : soundtrack path — null = placeholder
     tide  : climate-dispatch line for the delta arc (Future Tides framing) — optional
   ========================================================================== */
window.PK = { byId: {
  "01": { title:"In that Empire, the Art of Cartography attained such Perfection…", sub:"the littoral edge, measured at every water level", sci:"coastal salt marsh · estuarine intertidal (Spartina)", audio:null },
  "02": { title:"Amorphous Androgynous", sub:"the kelp forest, moonlit, in the shallows", sci:"kelp forest · subtidal marine ecotone", audio:null },
  "03": { title:"mono no aware", sub:"VVIM point-field over an invented surface", sci:"speculative island biome · invented ground", audio:null },
  "04": { title:"Hertzian Stream", sub:"the Plot — a forest that drains itself", sci:"riparian montane forest · self-draining watershed", audio:null },
  "05": { title:"Forest of Selective Memories.", sub:"the forest keeps only the seasons it chooses to", sci:"temperate deciduous forest · seasonal broadleaf", audio:null },
  "06": { title:"Cenote — a forgotten portal to the Mayan underworld.", sub:"the river falls through the eye of the world, into Xibalba", sci:"karst sinkhole · tropical cenote", audio:null },
  "07": { title:"Oaxacan Resonance", sub:"look up — the long light falls, and a wing crosses it", sci:"collapsed karst chamber · cave forest", audio:null },
  "08": { title:"Whisper Well — when moon spirits descend into the mycelium underworld.", sub:"roots grow from the trees, drink from the well, and go back down", sci:"mycorrhizal woodland · subterranean fungal network", audio:null },
  "09": { title:"Atlas of Lost Moons and Future Forests.", sub:"a map whose size was that of the empire", sci:"stratified lacustrine forest · percolating aquifer", audio:null },
  "10": { title:"Soul Pools — every well remembers a different moon.", sub:"a forest of still water, a sky of many moons", sci:"freshwater lacustrine wetland · pool complex", audio:null },
  "11": { title:"Poems of Future Subsidence.", sub:"the land keeps drafting, and slowly settling, its own contour", sci:"subsiding coastal lowland · deflation basin", audio:null },
  "12": { title:"Murmurations and Incantations.", sub:"the wind writes over the hills what the water is about to say", sci:"temperate upland grassland · fluvial catchment", audio:null },
  "13": { title:"Point Cloud Forests.", sub:"a night wood of counted light, under a ringed moon", sci:"mixed broadleaf forest · point-cloud canopy", audio:null },
  "14": { title:"Tropics of Cancer & Capricorn.", sub:"a Wat collapsing back into jungle, year 3000, two suns keeping their latitudes", sci:"tropical monsoon forest · successional ruin-jungle", audio:null },
  "15": { title:"Arctic Suns & Deserts Inclemencies.", sub:"delivered up to the inclemencies of sun and winters", sci:"cold polar desert · periglacial dune", audio:null },
  "16": { title:"Beyond the Ecliptic.", sub:"moons on tilted rings, and one far shore still green", sci:"exo-orbital biome · speculative / extraterrestrial", audio:null },
  "17": { title:"Ayutthaya 3000.", sub:"the city floods, and answers with ten thousand lanterns", sci:"riverine flood plain · drowned urban delta", tide:"Chao Phraya floodplain · the old capital, already water", audio:null },
  "18": { title:"neo-Bangkok 2126 CE.", sub:"urban metabolisms, city as organism, tidal futures · Krung Thep Maha Nakhon · กรุงเทพมหานคร", sci:"estuarine tidal delta · urbanized (Chao Phraya)", tide:"≈7M within ~2 ft of high tide [cited]", audio:null },
  "19": { title:"Nusantara 2076 CE.", sub:"sea-level projection of the relocated capital, fifty years out · Ibu Kota Nusantara · IKN", sci:"equatorial peat-swamp forest · planned garden-city", tide:"a capital built to flee a sinking one", audio:null },
  "20": { title:"Singapore 2226 CE.", sub:"the garden holds the sea back, and pours it politely · Singapura · 新加坡 · சிங்கப்பூர்", sci:"reclaimed coastal wetland · engineered barrier", tide:"engineered barrier · polders, pumps, patience", audio:null },
  "21": { title:"Jakarta 2046 CE.", sub:"subsidence + sea-level projection of the sinking delta megacity, twenty years out · Jakarta · DKI Jakarta", sci:"subsiding deltaic plain · tidal-flood megacity", tide:"subsiding faster than the sea is rising", audio:null },
  "22": { title:"Manila 2126 CE.", sub:"typhoon + storm-surge projection of the bay megacity, a century out · Maynila", sci:"typhoon-coast estuarine delta · storm-surge", tide:"typhoon coast · storm-surge exposed", audio:null },
  "24": { title:"neo-Saigon 2126 CE.", sub:"tidal-delta projection of the drowned ward, aquaculture in the streets · Sài Gòn · Thành phố Hồ Chí Minh", sci:"tidal delta megacity · drowned-ward aquaculture", tide:"Saigon–Mekong delta · low, flat, and counting", audio:null },
}};
