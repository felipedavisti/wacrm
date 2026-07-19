import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Read the locale from the environment. The product ships in Brazilian
  // Portuguese, so pt-BR is the default when NEXT_PUBLIC_APP_LOCALE is unset
  // (spec 002, FR-006). The `en` dictionary remains the fallback below when a
  // requested locale's file doesn't exist.
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt-BR';

  // Resolve the dictionary file: exact locale → base language → en. The
  // product ships pt-BR (`messages/pt-BR.json`, spec 002); this chain also
  // tolerates a bare `pt` or any other region tag, with `en.json` as the
  // last-resort fallback. Using a loop variable (not the inlined
  // NEXT_PUBLIC_ literal) keeps this a dynamic import over the existing
  // dictionaries, so a missing candidate doesn't error the build.
  const candidates = [locale, locale.split('-')[0], 'en'];
  let messages;
  for (const candidate of candidates) {
    try {
      messages = (await import(`../../messages/${candidate}.json`)).default;
      break;
    } catch {
      // Dictionary for this candidate doesn't exist — try the next one.
    }
  }

  return {
    // Keep the requested locale for Intl formatting (pt-BR number/date rules),
    // even when the messages came from the base-language dictionary.
    locale,
    messages,
  };
});
