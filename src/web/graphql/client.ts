import { Client, cacheExchange, fetchExchange } from 'urql';

/**
 * The session lives in an HttpOnly cookie, so the client holds no credentials.
 * Every workspace operation names its workspace in its variables, so results
 * for one club are never served from the cache for another.
 */
export function createClient(): Client {
  return new Client({
    url: '/graphql',
    exchanges: [cacheExchange, fetchExchange],
    requestPolicy: 'cache-and-network',
    preferGetMethod: false,
    fetchOptions: { credentials: 'same-origin' },
  });
}
