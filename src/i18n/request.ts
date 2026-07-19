import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Read the locale from the environment. The product ships in Brazilian
  // Portuguese, so pt-BR is the default when NEXT_PUBLIC_APP_LOCALE is unset
  // (spec 002, FR-006). The `en` dictionary remains the fallback below when a
  // requested locale's file doesn't exist.
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});
