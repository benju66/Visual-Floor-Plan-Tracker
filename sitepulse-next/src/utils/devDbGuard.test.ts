import { describe, it, expect } from 'vitest';
import { isLocalDevOnProdDb, PROD_PROJECT_REF } from './devDbGuard';

const PROD_URL = `https://${PROD_PROJECT_REF}.supabase.co`;

describe('isLocalDevOnProdDb', () => {
  it('is true when a dev build points at the production ref', () => {
    expect(
      isLocalDevOnProdDb({ nodeEnv: 'development', supabaseUrl: PROD_URL, prodRef: PROD_PROJECT_REF }),
    ).toBe(true);
  });

  it('is false in a production build even when the URL is the prod ref', () => {
    expect(
      isLocalDevOnProdDb({ nodeEnv: 'production', supabaseUrl: PROD_URL, prodRef: PROD_PROJECT_REF }),
    ).toBe(false);
  });

  it('is false when a dev build points at a different / local database', () => {
    expect(
      isLocalDevOnProdDb({
        nodeEnv: 'development',
        supabaseUrl: 'http://localhost:54321',
        prodRef: PROD_PROJECT_REF,
      }),
    ).toBe(false);
  });

  it('is false when no Supabase URL is resolvable', () => {
    expect(
      isLocalDevOnProdDb({ nodeEnv: 'development', supabaseUrl: undefined, prodRef: PROD_PROJECT_REF }),
    ).toBe(false);
    expect(
      isLocalDevOnProdDb({ nodeEnv: 'development', supabaseUrl: '', prodRef: PROD_PROJECT_REF }),
    ).toBe(false);
  });
});
