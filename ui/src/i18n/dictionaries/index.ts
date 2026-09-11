import type { Locale } from "../locales.js";
import type { Messages } from "./en.js";
import { buyEn } from "./buy-en.js";
import { createPasskeyEn } from "./create-passkey-en.js";
import { createWizardEn } from "./create-wizard-en.js";
import { onrampErrorsEn } from "./onramp-errors-en.js";
import { payFaucetEn } from "./pay-faucet-en.js";
import { en } from "./en.js";
import { ar } from "./ar.js";
import { bn } from "./bn.js";
import { de } from "./de.js";
import { es } from "./es.js";
import { nb } from "./nb.js";
import { sv } from "./sv.js";
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
import { applyLocaleOverlays } from "./overlay-merge.js";
import { overlayFill } from "./overlay-fill.js";
import { overlayForce } from "./overlay-force.js";

function withPasskeyCreate(messages: Omit<Messages, "buy"> & { buy?: Messages["buy"] }): Messages {
  return {
    ...messages,
    buy: { ...buyEn, ...messages.buy },
    create: { ...createPasskeyEn, ...createWizardEn, ...messages.create },
    pay: { ...payFaucetEn, ...messages.pay },
    errors: { ...onrampErrorsEn, ...messages.errors },
  } as Messages;
}

function withPasskey(
  locale: Locale,
  messages: Omit<Messages, "buy"> & { buy?: Messages["buy"] }
): Messages {
  return applyLocaleOverlays(locale, withPasskeyCreate(messages), overlayFill, overlayForce);
}

export const dictionaries: Record<Locale, Messages> = {
  en: withPasskey("en", en),
  "zh-Hans": withPasskey("zh-Hans", zhHans),
  "zh-Hant": withPasskey("zh-Hant", zhHant),
  es: withPasskey("es", es),
  ar: withPasskey("ar", ar),
  hi: withPasskey("hi", hi),
  "pt-BR": withPasskey("pt-BR", ptBR),
  bn: withPasskey("bn", bn),
  ru: withPasskey("ru", ru),
  ja: withPasskey("ja", ja),
  de: withPasskey("de", de),
  sv: withPasskey("sv", sv),
  nb: withPasskey("nb", nb),
  fr: withPasskey("fr", fr),
  id: withPasskey("id", id),
  ko: withPasskey("ko", ko),
  tr: withPasskey("tr", tr),
  it: withPasskey("it", it),
  vi: withPasskey("vi", vi),
  th: withPasskey("th", th),
  pl: withPasskey("pl", pl),
  nl: withPasskey("nl", nl),
  uk: withPasskey("uk", uk),
  fa: withPasskey("fa", fa),
  ms: withPasskey("ms", ms),
  he: withPasskey("he", he),
  ur: withPasskey("ur", ur),
};
