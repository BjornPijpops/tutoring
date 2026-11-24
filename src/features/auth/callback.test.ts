import { describe, expect, it } from 'vitest';
import { readOAuthCallback } from './callback';

const read = (url: string) => readOAuthCallback(new URL(url));

describe('readOAuthCallback', () => {
  it('reports none for a normal URL', () => {
    const result = read('https://x.test/tutoring/#/calendar');
    expect(result.outcome).toBe('none');
    expect(result.cleanUrl).toBe('https://x.test/tutoring/#/calendar');
  });

  it('detects a code and strips the callback parameters', () => {
    const result = read('https://x.test/tutoring/?code=abc&state=s&keep=1#/');
    expect(result.outcome).toBe('success');
    expect(result.cleanUrl).toBe('https://x.test/tutoring/?keep=1#/');
  });

  it('treats access_denied as cancelled', () => {
    const result = read('https://x.test/tutoring/?error=access_denied&error_description=No');
    expect(result.outcome).toBe('cancelled');
    expect(result.cleanUrl).toBe('https://x.test/tutoring/');
  });

  it('treats any other error as failed', () => {
    expect(read('https://x.test/?error=server_error&error_code=500').outcome).toBe('failed');
  });

  it('ignores a code inside the hash fragment', () => {
    expect(read('https://x.test/#/login?code=abc').outcome).toBe('none');
  });
});
