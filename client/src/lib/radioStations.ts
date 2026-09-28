export type RadioStation = {
  id: string;
  name: string;
  streamUrl?: string;
  /** Extra live mounts tried if the primary URL stalls, ends or errors. */
  streamUrls?: string[];
  pageUrl: string;
  note?: string;
};

export function stationStreamUrls(station: RadioStation): string[] {
  const listed = [...(station.streamUrls ?? [])];
  if (station.streamUrl) listed.unshift(station.streamUrl);
  return [...new Set(listed.filter((url) => url.length > 0))];
}

/** Live mounts must not be reused from the HTTP cache or they loop a short chunk. */
export function cacheBustStream(url: string, token: number): string {
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}_=${token}`;
}

export function stripCacheBust(url: string): string {
  return url.replace(/[?&]_=\d+$/, "").replace(/[?&]$/, "");
}

const RADIO_FILLER = /^(pon|ponga|ponme|reproduce|reproducir|escucha|sintoniza|enciende|reanuda|cambia|cambiar|selecciona|seleccionar|la|el|los|las|emisora|radio|de|fm)$/;

function foldRadioText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

function compactRadioText(value: string): string {
  return foldRadioText(value).replace(/[^a-z0-9]+/g, "");
}

/** Picks the catalog station for a spoken or typed name. "Remember" is Remember The Music FM, not Loca FM Remember. */
export function matchRadioStation(query: string, stations: readonly RadioStation[] = RADIO_STATIONS): RadioStation | undefined {
  const tokens = foldRadioText(query).split(/\s+/).filter((token) => token && !RADIO_FILLER.test(token));
  const compact = compactRadioText(tokens.join(" "));
  if (!compact) return undefined;

  let best: { station: RadioStation; score: number } | undefined;
  for (const station of stations) {
    const nameCompact = compactRadioText(station.name);
    const nameNoFm = nameCompact.replace(/fm/g, "");
    const idCompact = compactRadioText(station.id);
    const nameTokens = foldRadioText(station.name).split(/\s+/).filter((token) => token && token !== "fm");
    let score = 0;
    if (nameCompact === compact || idCompact === compact || nameNoFm === compact) {
      score = 1000 + nameCompact.length;
    } else if (nameCompact.startsWith(compact) || nameNoFm.startsWith(compact)) {
      score = 800 + compact.length;
    } else if (compact.includes(nameCompact) || compact.includes(nameNoFm)) {
      score = 600 + nameNoFm.length;
    } else if (compact.length >= 6 && (nameCompact.includes(compact) || nameNoFm.includes(compact))) {
      score = 400 + compact.length;
    } else if (nameTokens.length > 0 && nameTokens.every((token) => compact.includes(compactRadioText(token)))) {
      score = 300 + nameTokens.join("").length;
    } else if (tokens.length > 1 && tokens.every((token) => nameCompact.includes(compactRadioText(token)))) {
      score = 250 + tokens.join("").length;
    }
    if (score > (best?.score ?? 0)) best = { station, score };
  }
  return best?.station;
}

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: "loca-urban",
    name: "Loca FM Urban",
    streamUrl: "https://s1.we4stream.com:2020/stream/locaurban",
    pageUrl: "https://www.locafm.com/loca-urban/player.html",
    note: "Urbano, reguetón y latin",
  },
  {
    id: "loca-fm",
    name: "Loca FM",
    streamUrl: "https://s3.we4stream.com:2020/stream/locafm",
    pageUrl: "https://www.locafm.com/live/player.html",
    note: "Electrónica y dance en directo",
  },
  {
    id: "loca-dance",
    name: "Loca FM Dance",
    streamUrl: "https://s2.we4stream.com/listen/loca_dance/live",
    pageUrl: "https://www.locafm.com/dance/player.html",
    note: "Dance y éxitos de club",
  },
  {
    id: "loca-remember",
    name: "Loca FM Remember",
    streamUrl: "https://s2.we4stream.com/listen/loca_remember/live",
    pageUrl: "https://www.locafm.com/remember/player.html",
    note: "Clásicos dance y mákina",
  },
  {
    id: "loca-house",
    name: "Loca FM House",
    streamUrl: "https://s2.we4stream.com/listen/loca_house/live",
    pageUrl: "https://www.locafm.com/house/player.html",
    note: "House",
  },
  {
    id: "loca-chill",
    name: "Loca FM Chill Out",
    streamUrl: "https://s2.we4stream.com/listen/loca_chill_out/live",
    pageUrl: "https://www.locafm.com/chill-out/player.html",
    note: "Chill out",
  },
  {
    id: "loca-hard",
    name: "Loca FM Hard",
    streamUrl: "https://s2.we4stream.com/listen/loca_hard/live",
    pageUrl: "https://www.locafm.com/hard/player.html",
    note: "Hard dance",
  },
  {
    id: "loca-techno",
    name: "Loca FM Techno",
    streamUrl: "https://s2.we4stream.com/listen/loca_techo/live",
    pageUrl: "https://www.locafm.com/techno/player.html",
    note: "Techno",
  },
  {
    id: "loca-80s",
    name: "Loca FM 80s",
    streamUrl: "https://s2.we4stream.com/listen/loca_80s/live",
    pageUrl: "https://www.locafm.com/loca-80-s/player.html",
    note: "Electrónica de los 80",
  },
  {
    id: "loca-90s",
    name: "Loca FM 90s",
    streamUrl: "https://s2.we4stream.com/listen/loca_90s_/live",
    pageUrl: "https://www.locafm.com/loca-90-s/player.html",
    note: "Electrónica de los 90",
  },
  {
    id: "gozadera",
    name: "Gozadera FM",
    streamUrl: "https://azura.abcorp.es/listen/gozadera_en_directo/live",
    streamUrls: [
      "https://azura.abcorp.es/listen/gozadera_en_directo/aac",
      "https://streaming.shoutcast.com/gozadera",
    ],
    pageUrl: "https://gozadera.es/",
    note: "Reguetón y música urbana",
  },
  {
    id: "los40",
    name: "LOS40",
    streamUrl: "https://playerservices.streamtheworld.com/api/livestream-redirect/Los40.mp3",
    pageUrl: "https://play.los40.com/",
    note: "Éxitos y fórmula musical",
  },
  {
    id: "cadena-dial",
    name: "Cadena Dial",
    streamUrl: "https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIAL.mp3",
    pageUrl: "https://www.cadenadial.com/",
    note: "Música en español",
  },
  {
    id: "los40-dance",
    name: "LOS40 Dance",
    streamUrl: "https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40_DANCE.mp3",
    pageUrl: "https://los40.com/los40_dance/",
    note: "Dance y electrónica",
  },
  {
    id: "remember-music",
    name: "Remember The Music FM",
    streamUrl: "https://eu1.lhdserver.es:9041/stream",
    pageUrl: "https://tunein.com/radio/REMEMBER-THE-MUSIC-FM-966-VALENCIA-s236651/",
    note: "Remember desde Valencia",
  },
  {
    id: "wifon-fm",
    name: "Wifon FM",
    streamUrl: "https://betelgeuse.nucast.co.uk:8044/wifonfm",
    pageUrl: "https://wifonfm.es/#player",
    note: "Remember murciano 24 h",
  },
];
