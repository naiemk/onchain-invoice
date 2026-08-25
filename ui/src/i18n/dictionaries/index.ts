import type { Locale } from "../locales.js";
import type { Messages } from "./en.js";
import { createPasskeyEn } from "./create-passkey-en.js";
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

function withPasskeyCreate(messages: Messages): Messages {
  return { ...messages, create: { ...messages.create, ...createPasskeyEn } };
}

const withPasskey = (m: Messages) => withPasskeyCreate(m);

export const dictionaries: Record<Locale, Messages> = {
  en: withPasskey(en),
  "zh-Hans": withPasskey(zhHans),
  "zh-Hant": withPasskey(zhHant),
  es: withPasskey(es),
  ar: withPasskey(ar),
  hi: withPasskey(hi),
  "pt-BR": withPasskey(ptBR),
  bn: withPasskey(bn),
  ru: withPasskey(ru),
  ja: withPasskey(ja),
  de: withPasskey(de),
  fr: withPasskey(fr),
  id: withPasskey(id),
  ko: withPasskey(ko),
  tr: withPasskey(tr),
  it: withPasskey(it),
  vi: withPasskey(vi),
  th: withPasskey(th),
  pl: withPasskey(pl),
  nl: withPasskey(nl),
  uk: withPasskey(uk),
  fa: withPasskey(fa),
  ms: withPasskey(ms),
  he: withPasskey(he),
  ur: withPasskey(ur),
};
