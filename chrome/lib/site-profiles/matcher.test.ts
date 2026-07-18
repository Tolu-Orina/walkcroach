import { describe, expect, it } from 'vitest';
import { matchSiteProfile, profilesVersion, SITE_PROFILES } from './matcher';

describe('site profiles v1', () => {
  it('has versioned bundle with five sectors', () => {
    expect(profilesVersion()).toBe(1);
    const sectors = new Set(SITE_PROFILES.profiles.map((p) => p.sector));
    expect(sectors.has('recruiting')).toBe(true);
    expect(sectors.has('sales')).toBe(true);
    expect(sectors.has('retail')).toBe(true);
    expect(sectors.has('real_estate')).toBe(true);
    expect(sectors.has('support')).toBe(true);
  });

  it('matches LinkedIn profile → recruiting', () => {
    const p = matchSiteProfile('https://www.linkedin.com/in/jane-doe/');
    expect(p?.actionId).toBe('extract_candidate');
    expect(p?.defaultWorkspace).toBe('Hiring');
  });

  it('matches LinkedIn company → sales', () => {
    const p = matchSiteProfile('https://www.linkedin.com/company/acme/');
    expect(p?.actionId).toBe('extract_lead');
  });

  it('matches Amazon product → track price', () => {
    const p = matchSiteProfile('https://www.amazon.com/dp/B0EXAMPLE');
    expect(p?.actionId).toBe('track_price');
    expect(p?.captureType).toBe('price');
  });

  it('matches Zillow listing → real estate', () => {
    const p = matchSiteProfile(
      'https://www.zillow.com/homedetails/123-Main-St/111_zpid/',
    );
    expect(p?.actionId).toBe('summarize_listing');
  });

  it('matches Gmail → support draft', () => {
    const p = matchSiteProfile('https://mail.google.com/mail/u/0/#inbox');
    expect(p?.actionId).toBe('draft_support');
    expect(p?.draftTone).toContain('support');
  });

  it('returns null for unmatched sites', () => {
    expect(matchSiteProfile('https://example.com/about')).toBeNull();
  });
});
