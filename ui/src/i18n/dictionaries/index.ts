import type { Locale } from "../locales.js";
import type { Messages } from "./en.js";
import { en } from "./en.js";
import { ar } from "./ar.js";
import { bn } from "./bn.js";
import { de } from "./de.js";
import { es } from "./es.js";
import { fa } from "./fa.js";
import { fr } from "./fr.js";
import { he } from "./he.js";
import { hi } from "./hi.js";
import { id } from "./id.js";
import { it } from "./it.js";
import { ja } from "./ja.js";
import { ko } from "./ko.js";
import { ms } from "./ms.js";
import { nl } from "./nl.js";
import { pl } from "./pl.js";
import { ptBR } from "./pt-BR.js";
import { ru } from "./ru.js";
import { th } from "./th.js";
import { tr } from "./tr.js";
import { uk } from "./uk.js";
import { ur } from "./ur.js";
import { vi } from "./vi.js";
import { zhHans } from "./zh-Hans.js";
import { zhHant } from "./zh-Hant.js";

export const dictionaries: Record<Locale, Messages> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  es,
  ar,
  hi,
  "pt-BR": ptBR,
  bn,
  ru,
  ja,
  de,
  fr,
  id,
  ko,
  tr,
  it,
  vi,
  th,
  pl,
  nl,
  uk,
  fa,
  ms,
  he,
  ur,
};
